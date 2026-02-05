import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { InvitationService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser, hasPermission } from '@flowtask/auth';
import { CreateInvitationSchema } from '@flowtask/shared';

const invitations = new Hono();
const db = getDatabase();
const invitationService = new InvitationService(db);
const workspaceService = new WorkspaceService(db);

// === Workspace-scoped routes (require auth and workspace membership) ===

// Create invitation
invitations.post(
  '/workspaces/:workspaceId/invitations',
  zValidator('json', CreateInvitationSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const data = c.req.valid('json');

    // Check permission
    const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
    if (!roleResult.ok || !roleResult.value) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
    }

    if (!hasPermission(roleResult.value, 'workspace:manage_members')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }

    // For email-specific invitations, default maxUses to 1
    // For generic links (no email), use the provided maxUses or null (unlimited)
    const isGeneric = !data.email;
    const maxUses = data.maxUses !== undefined ? data.maxUses : (isGeneric ? null : 1);

    const result = await invitationService.create({
      workspaceId,
      email: data.email ?? null,
      role: data.role,
      invitedBy: user.id,
      maxUses,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    // Generate the invite URL
    const baseUrl = process.env.WEB_URL || 'http://localhost:5173';
    const inviteUrl = `${baseUrl}/invite/${result.value.token}`;

    return c.json({
      success: true,
      data: {
        ...result.value,
        inviteUrl,
        isGeneric,
      },
    }, 201);
  }
);

// List invitations for a workspace
invitations.get('/workspaces/:workspaceId/invitations', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const status = c.req.query('status') as 'pending' | 'accepted' | 'revoked' | undefined;

  // Check permission
  const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
  if (!roleResult.ok || !roleResult.value) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
  }

  if (!hasPermission(roleResult.value, 'workspace:manage_members')) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
  }

  const result = await invitationService.listByWorkspace({
    workspaceId,
    status,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  // Add invite URLs and computed fields to each invitation
  const baseUrl = process.env.WEB_URL || 'http://localhost:5173';
  const invitationsWithUrls = result.value.map((inv) => ({
    ...inv,
    inviteUrl: `${baseUrl}/invite/${inv.token}`,
    isGeneric: inv.email === null,
  }));

  return c.json({ success: true, data: invitationsWithUrls });
});

// Revoke invitation
invitations.delete('/workspaces/:workspaceId/invitations/:invitationId', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const invitationId = c.req.param('invitationId');

  // Check permission
  const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
  if (!roleResult.ok || !roleResult.value) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
  }

  if (!hasPermission(roleResult.value, 'workspace:manage_members')) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
  }

  // Verify the invitation belongs to this workspace
  const invResult = await invitationService.getById(invitationId);
  if (!invResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Invitation not found' } }, 404);
  }

  if (invResult.value.workspaceId !== workspaceId) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Invitation does not belong to this workspace' } }, 403);
  }

  const result = await invitationService.revoke({
    invitationId,
    revokedBy: user.id,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'REVOKE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

export { invitations as invitationRoutes };

// === Public routes (require token but no auth) ===

const publicInvitations = new Hono();

// Get invitation by token (public - no auth required)
publicInvitations.get('/invitations/:token', async (c) => {
  const token = c.req.param('token');

  const result = await invitationService.getByToken(token);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const invitation = result.value;

  // Check if expired
  if (new Date() > new Date(invitation.expiresAt)) {
    return c.json({
      success: false,
      error: { code: 'EXPIRED', message: 'This invitation has expired' },
    }, 410);
  }

  // Check if already accepted or revoked
  if (invitation.status !== 'pending') {
    return c.json({
      success: false,
      error: { code: 'INVALID', message: `This invitation has already been ${invitation.status}` },
    }, 410);
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

acceptInvitations.post('/invitations/:token/accept', async (c) => {
  const user = getCurrentUser(c);
  const token = c.req.param('token');

  const result = await invitationService.accept({
    token,
    userId: user.id,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'ACCEPT_FAILED', message: result.error.message } }, 400);
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
