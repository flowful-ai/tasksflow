import type { WorkspaceInvitation, User } from '@flowtask/database';
import type { InvitationRole, InvitationStatus } from '@flowtask/shared';

export interface InvitationWithInviter extends WorkspaceInvitation {
  inviter: User | null;
  workspaceName: string;
}

export interface CreateInvitationInput {
  workspaceId: string;
  email: string | null; // null for generic links
  role: InvitationRole;
  invitedBy: string;
  maxUses: number | null; // null = unlimited
}

export interface AcceptInvitationInput {
  token: string;
  userId: string;
}

export interface RevokeInvitationInput {
  invitationId: string;
  revokedBy: string;
}

export interface ListInvitationsOptions {
  workspaceId: string;
  status?: InvitationStatus;
}
