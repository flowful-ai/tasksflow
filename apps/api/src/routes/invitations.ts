import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { InvitationService, isDomainError } from '../domain/index.js';
import { CreateInvitationSchema } from '@flowtask/shared';
import { getWebUrl } from '../integrations/index.js';
import { requireUser, requireWorkspace } from '../lib/authorize.js';
import {
  AppError,
  badRequest,
  fromResult,
  notFound,
  validationHook,
  handleRouteError,
} from '../lib/responses.js';

const invitations = new Hono();
invitations.onError(handleRouteError);
const db = getDatabase();
const invitationService = new InvitationService(db);

const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const;
type InvitationStatusFilter = (typeof INVITATION_STATUSES)[number];

function isInvitationStatus(value: string | undefined): value is InvitationStatusFilter {
  return INVITATION_STATUSES.some((status) => status === value);
}

function inviteUrl(token: string): string {
  return `${getWebUrl()}/invite/${token}`;
}

// === Workspace-scoped routes (require auth and workspace membership) ===

// Create invitation
invitations.post(
  '/workspaces/:workspaceId/invitations',
  zValidator('json', CreateInvitationSchema, validationHook),
  async (c) => {
    const data = c.req.valid('json');
    const { user, workspaceId } = await requireWorkspace(
      c,
      c.req.param('workspaceId'),
      'workspace:manage_members'
    );

    // For email-specific invitations, default maxUses to 1
    // For generic links (no email), use the provided maxUses or null (unlimited)
    const isGeneric = !data.email;
    const maxUses = data.maxUses !== undefined ? data.maxUses : isGeneric ? null : 1;

    const invitation = fromResult(
      await invitationService.create({
        workspaceId,
        email: data.email ?? null,
        role: data.role,
        invitedBy: user.id,
        maxUses,
      }),
      { status: 400, code: 'CREATE_FAILED', message: 'Failed to create invitation' }
    );

    return c.json(
      {
        success: true,
        data: { ...invitation, inviteUrl: inviteUrl(invitation.token), isGeneric },
      },
      201
    );
  }
);

// List invitations for a workspace
invitations.get('/workspaces/:workspaceId/invitations', async (c) => {
  const { workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_members'
  );
  const statusQuery = c.req.query('status');
  const status = isInvitationStatus(statusQuery) ? statusQuery : undefined;

  const list = fromResult(await invitationService.listByWorkspace({ workspaceId, status }), {
    code: 'LIST_FAILED',
    message: 'Failed to list invitations',
  });

  const invitationsWithUrls = list.map((inv) => ({
    ...inv,
    inviteUrl: inviteUrl(inv.token),
    isGeneric: inv.email === null,
  }));

  return c.json({ success: true, data: invitationsWithUrls });
});

// Revoke invitation
invitations.delete('/workspaces/:workspaceId/invitations/:invitationId', async (c) => {
  const { user, workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_members'
  );
  const invitationId = c.req.param('invitationId');

  // The invitation must belong to this workspace.
  const invResult = await invitationService.getById(invitationId);
  if (!invResult.ok || invResult.value.workspaceId !== workspaceId) {
    throw notFound('Invitation');
  }

  fromResult(await invitationService.revoke({ invitationId, revokedBy: user.id }), {
    status: 400,
    code: 'REVOKE_FAILED',
    message: 'Failed to revoke invitation',
  });

  return c.json({ success: true, data: null });
});

export { invitations as invitationRoutes };

// === Public routes (require token but no auth) ===

const publicInvitations = new Hono();
publicInvitations.onError(handleRouteError);

// Get invitation by token (public - no auth required)
publicInvitations.get('/invitations/:token', async (c) => {
  const token = c.req.param('token');

  const result = await invitationService.getByToken(token);
  if (!result.ok) throw notFound('Invitation');
  const invitation = result.value;

  if (new Date() > new Date(invitation.expiresAt)) {
    throw new AppError(410, 'EXPIRED', 'This invitation has expired');
  }
  if (invitation.status !== 'pending') {
    throw new AppError(410, 'INVALID', `This invitation has already been ${invitation.status}`);
  }

  // Return public-safe invitation data
  return c.json({
    success: true,
    data: {
      id: invitation.id,
      workspaceName: invitation.workspaceName,
      email: invitation.email,
      role: invitation.role,
      isGeneric: invitation.email === null,
      maxUses: invitation.maxUses,
      usesCount: invitation.usesCount,
      expiresAt: invitation.expiresAt,
      invitedBy: invitation.inviter
        ? { name: invitation.inviter.name, email: invitation.inviter.email }
        : null,
    },
  });
});

// Accept invitation (requires auth)
const acceptInvitations = new Hono();
acceptInvitations.onError(handleRouteError);

acceptInvitations.post('/invitations/:token/accept', async (c) => {
  const user = requireUser(c);
  const token = c.req.param('token');

  const result = await invitationService.accept({ token, userId: user.id });
  if (!result.ok) {
    // Business failures (expired, exhausted, wrong email, already a member) are
    // DomainErrors with a client-safe message; anything else is logged.
    if (isDomainError(result.error)) throw badRequest(result.error.message, 'ACCEPT_FAILED');
    console.error('[invitations] accept failed:', result.error);
    throw new AppError(500, 'ACCEPT_FAILED', 'Failed to accept invitation');
  }

  // Get the invitation to return workspace info
  const invResult = await invitationService.getByToken(token);

  return c.json({
    success: true,
    data: {
      workspaceId: invResult.ok ? invResult.value.workspaceId : null,
      workspaceName: invResult.ok ? invResult.value.workspaceName : null,
    },
  });
});

export { publicInvitations as publicInvitationRoutes, acceptInvitations as acceptInvitationRoutes };
