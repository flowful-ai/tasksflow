import type { Context } from 'hono';
import { getDatabase } from '../db/index.js';
import {
  AuthorizationService,
  canAccessSmartView,
  SmartViewService,
  type AuthzDenial,
  type AuthzResult,
  type ProjectGrant,
  type SmartViewAction,
  type SmartViewWithRelations,
  type TaskAuthorizationOptions,
  type TaskGrant,
  type WorkspaceGrant,
} from '../domain/index.js';
import {
  getOptionalUser,
  hasPermission,
  type AuthSession,
  type AuthUser,
  type WorkspacePermission,
} from '../auth/index.js';
import { AppError, forbidden, fromResult, notFound, unauthorized } from './responses.js';

/**
 * Thin Hono helpers over the domain AuthorizationService. Each `require*`
 * returns the granted entities or throws an AppError (401/403/404), which the
 * router's `handleRouteError` turns into a JSON response.
 */

let authzInstance: AuthorizationService<WorkspacePermission> | null = null;
let smartViewServiceInstance: SmartViewService | null = null;

export function getAuthz(): AuthorizationService<WorkspacePermission> {
  if (!authzInstance) {
    authzInstance = new AuthorizationService<WorkspacePermission>(getDatabase(), hasPermission);
  }
  return authzInstance;
}

function getSmartViewService(): SmartViewService {
  if (!smartViewServiceInstance) {
    smartViewServiceInstance = new SmartViewService(getDatabase());
  }
  return smartViewServiceInstance;
}

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'userId' in value &&
    typeof value.userId === 'string'
  );
}

/** The authenticated user, or a 401. */
export function requireUser(c: Context): AuthUser {
  const user = getOptionalUser(c);
  if (!user) throw unauthorized();
  return user;
}

/** The authenticated user's session, or a 401. */
export function requireSession(c: Context): AuthSession {
  const auth: unknown = c.get('auth');
  const session =
    typeof auth === 'object' && auth !== null && 'session' in auth ? auth.session : null;
  if (!isAuthSession(session)) throw unauthorized();
  return session;
}

export function denialToError(denial: AuthzDenial): AppError {
  return denial.reason === 'not_found'
    ? new AppError(404, 'NOT_FOUND', denial.message)
    : new AppError(403, 'FORBIDDEN', denial.message);
}

function unwrap<G extends { ok: true }>(result: AuthzResult<G>): G {
  if (result.ok === false) throw denialToError(result);
  return result;
}

export async function requireWorkspace(
  c: Context,
  workspaceId: string | undefined,
  permission: WorkspacePermission
): Promise<WorkspaceGrant & { user: AuthUser }> {
  const user = requireUser(c);
  if (!workspaceId) throw new AppError(400, 'MISSING_PARAM', 'workspaceId is required');
  const grant = unwrap(await getAuthz().authorizeWorkspace(workspaceId, user.id, permission));
  return { ...grant, user };
}

export async function requireProject(
  c: Context,
  projectId: string | undefined,
  permission: WorkspacePermission
): Promise<ProjectGrant & { user: AuthUser }> {
  const user = requireUser(c);
  if (!projectId) throw new AppError(400, 'MISSING_PARAM', 'projectId is required');
  const grant = unwrap(await getAuthz().authorizeProject(projectId, user.id, permission));
  return { ...grant, user };
}

export async function requireTask(
  c: Context,
  taskId: string,
  permission: WorkspacePermission,
  options?: TaskAuthorizationOptions
): Promise<TaskGrant & { user: AuthUser }> {
  const user = requireUser(c);
  const grant = unwrap(await getAuthz().authorizeTask(taskId, user.id, permission, options));
  return { ...grant, user };
}

export type SmartViewGrant = WorkspaceGrant & {
  user: AuthUser;
  view: SmartViewWithRelations;
};

function smartViewRolePermissions(role: WorkspaceGrant['role']) {
  return {
    update: hasPermission(role, 'smart_view:update'),
    delete: hasPermission(role, 'smart_view:delete'),
    share: hasPermission(role, 'smart_view:share'),
  };
}

/**
 * Load a smart view and check the caller may perform `action` on it.
 * Views the caller cannot read (other workspace, someone else's personal
 * view) are reported as 404; readable views the caller cannot modify as 403.
 */
export async function requireSmartView(
  c: Context,
  viewId: string,
  action: SmartViewAction
): Promise<SmartViewGrant> {
  const user = requireUser(c);
  const view = fromResult(await getSmartViewService().getById(viewId), {
    status: 500,
    code: 'FETCH_FAILED',
    message: 'Failed to load smart view',
  });

  const authz = getAuthz();
  const role = await authz.getRole(view.workspaceId, user.id);
  if (!role || !hasPermission(role, 'smart_view:read')) throw notFound('Smart view');

  const rolePermissions = smartViewRolePermissions(role);
  if (!canAccessSmartView(view, user.id, rolePermissions, 'read')) throw notFound('Smart view');
  if (!canAccessSmartView(view, user.id, rolePermissions, action)) throw forbidden();

  return { ok: true, workspaceId: view.workspaceId, role, user, view };
}

/** Whether the caller may manage sharing for this (already readable) view. */
export function canShareSmartView(grant: SmartViewGrant): boolean {
  return canAccessSmartView(
    grant.view,
    grant.user.id,
    smartViewRolePermissions(grant.role),
    'share'
  );
}
