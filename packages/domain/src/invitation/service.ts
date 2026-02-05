import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { workspaceInvitations, workspaceMembers, workspaces, users } from '@flowtask/database';
import type { Result, WorkspaceRole } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  InvitationWithInviter,
  CreateInvitationInput,
  AcceptInvitationInput,
  RevokeInvitationInput,
  ListInvitationsOptions,
} from './types.js';

const INVITATION_EXPIRY_DAYS = 7;

export class InvitationService {
  constructor(private db: Database) {}

  /**
   * Create a new invitation to a workspace.
   * Supports both email-specific invitations and generic links (email = null).
   */
  async create(input: CreateInvitationInput): Promise<Result<InvitationWithInviter, Error>> {
    try {
      // Check if workspace exists
      const [workspace] = await this.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId));

      if (!workspace) {
        return err(new Error('Workspace not found'));
      }

      // For email-specific invitations only:
      const emailLower = input.email ? input.email.toLowerCase() : null;

      if (emailLower) {
        // Check if user already exists and is already a member
        const [existingUser] = await this.db
          .select()
          .from(users)
          .where(eq(users.email, emailLower));

        if (existingUser) {
          const [existingMember] = await this.db
            .select()
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, input.workspaceId),
                eq(workspaceMembers.userId, existingUser.id)
              )
            );

          if (existingMember) {
            return err(new Error('User is already a member of this workspace'));
          }
        }

        // Check for existing pending invitation
        const [existingInvite] = await this.db
          .select()
          .from(workspaceInvitations)
          .where(
            and(
              eq(workspaceInvitations.workspaceId, input.workspaceId),
              eq(workspaceInvitations.email, emailLower),
              eq(workspaceInvitations.status, 'pending')
            )
          );

        if (existingInvite) {
          return err(new Error('An invitation for this email is already pending'));
        }
      }

      // Calculate expiry date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

      // Create the invitation
      const [invitation] = await this.db
        .insert(workspaceInvitations)
        .values({
          workspaceId: input.workspaceId,
          email: emailLower,
          role: input.role,
          invitedBy: input.invitedBy,
          maxUses: input.maxUses,
          usesCount: 0,
          expiresAt,
        })
        .returning();

      if (!invitation) {
        return err(new Error('Failed to create invitation'));
      }

      // Get inviter info
      const [inviter] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, input.invitedBy));

      return ok({
        ...invitation,
        inviter: inviter || null,
        workspaceName: workspace.name,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get an invitation by token (public endpoint).
   */
  async getByToken(token: string): Promise<Result<InvitationWithInviter, Error>> {
    try {
      const [invitation] = await this.db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.token, token));

      if (!invitation) {
        return err(new Error('Invitation not found'));
      }

      // Get workspace info
      const [workspace] = await this.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, invitation.workspaceId));

      if (!workspace) {
        return err(new Error('Workspace not found'));
      }

      // Get inviter info
      let inviter = null;
      if (invitation.invitedBy) {
        const [user] = await this.db
          .select()
          .from(users)
          .where(eq(users.id, invitation.invitedBy));
        inviter = user || null;
      }

      return ok({
        ...invitation,
        inviter,
        workspaceName: workspace.name,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * List invitations for a workspace.
   */
  async listByWorkspace(options: ListInvitationsOptions): Promise<Result<InvitationWithInviter[], Error>> {
    try {
      const conditions = [eq(workspaceInvitations.workspaceId, options.workspaceId)];

      if (options.status) {
        conditions.push(eq(workspaceInvitations.status, options.status));
      }

      const invitations = await this.db
        .select()
        .from(workspaceInvitations)
        .where(and(...conditions))
        .orderBy(desc(workspaceInvitations.createdAt));

      // Get workspace info
      const [workspace] = await this.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, options.workspaceId));

      if (!workspace) {
        return err(new Error('Workspace not found'));
      }

      // Get all inviters
      const inviterIds = [...new Set(invitations.map((i) => i.invitedBy).filter(Boolean))];
      let invitersMap = new Map<string, typeof users.$inferSelect>();

      if (inviterIds.length > 0) {
        const inviters = await Promise.all(
          inviterIds.map(async (id) => {
            const [user] = await this.db.select().from(users).where(eq(users.id, id!));
            return user;
          })
        );

        inviters.filter(Boolean).forEach((user) => {
          if (user) invitersMap.set(user.id, user);
        });
      }

      const result: InvitationWithInviter[] = invitations.map((invitation) => ({
        ...invitation,
        inviter: invitation.invitedBy ? invitersMap.get(invitation.invitedBy) || null : null,
        workspaceName: workspace.name,
      }));

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Accept an invitation.
   * Supports both email-specific invitations and generic links.
   * For multi-use links, increments usage count instead of marking as accepted.
   */
  async accept(input: AcceptInvitationInput): Promise<Result<void, Error>> {
    try {
      // Get the invitation
      const [invitation] = await this.db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.token, input.token));

      if (!invitation) {
        return err(new Error('Invitation not found'));
      }

      // Check status - 'pending' is valid, 'exhausted' means usage limit reached
      if (invitation.status !== 'pending') {
        if (invitation.status === 'exhausted') {
          return err(new Error('This invitation link has reached its usage limit'));
        }
        return err(new Error(`Invitation is already ${invitation.status}`));
      }

      if (new Date() > new Date(invitation.expiresAt)) {
        return err(new Error('Invitation has expired'));
      }

      // Check usage limit for multi-use invitations
      const currentUsesCount = invitation.usesCount ?? 0;
      if (invitation.maxUses !== null && currentUsesCount >= invitation.maxUses) {
        return err(new Error('This invitation link has reached its usage limit'));
      }

      // Get the user accepting
      const [user] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, input.userId));

      if (!user) {
        return err(new Error('User not found'));
      }

      // For email-specific invitations, check if the email matches
      // Generic invitations (email = null) can be accepted by anyone
      if (invitation.email !== null) {
        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
          return err(new Error('This invitation was sent to a different email address'));
        }
      }

      // Check if user is already a member
      const [existingMember] = await this.db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invitation.workspaceId),
            eq(workspaceMembers.userId, input.userId)
          )
        );

      if (existingMember) {
        // User is already a member
        return err(new Error('You are already a member of this workspace'));
      }

      // Add user as member
      await this.db.insert(workspaceMembers).values({
        workspaceId: invitation.workspaceId,
        userId: input.userId,
        role: invitation.role as WorkspaceRole,
      });

      // Update invitation status and usage count
      const newUsesCount = currentUsesCount + 1;
      const isExhausted = invitation.maxUses !== null && newUsesCount >= invitation.maxUses;

      // For single-use invitations (maxUses=1 or email-specific), mark as accepted
      // For multi-use, either mark as exhausted or keep pending
      const isEmailSpecific = invitation.email !== null;
      const isSingleUse = invitation.maxUses === 1;

      let newStatus: string;
      if (isEmailSpecific || isSingleUse) {
        newStatus = 'accepted';
      } else if (isExhausted) {
        newStatus = 'exhausted';
      } else {
        newStatus = 'pending'; // Multi-use link still has remaining uses
      }

      await this.db
        .update(workspaceInvitations)
        .set({
          status: newStatus,
          usesCount: newUsesCount,
          acceptedAt: (isEmailSpecific || isSingleUse) ? new Date() : invitation.acceptedAt,
        })
        .where(eq(workspaceInvitations.id, invitation.id));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Revoke an invitation.
   */
  async revoke(input: RevokeInvitationInput): Promise<Result<void, Error>> {
    try {
      const [invitation] = await this.db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, input.invitationId));

      if (!invitation) {
        return err(new Error('Invitation not found'));
      }

      if (invitation.status !== 'pending') {
        return err(new Error(`Cannot revoke invitation that is already ${invitation.status}`));
      }

      await this.db
        .update(workspaceInvitations)
        .set({ status: 'revoked' })
        .where(eq(workspaceInvitations.id, input.invitationId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get an invitation by ID.
   */
  async getById(invitationId: string): Promise<Result<InvitationWithInviter, Error>> {
    try {
      const [invitation] = await this.db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, invitationId));

      if (!invitation) {
        return err(new Error('Invitation not found'));
      }

      // Get workspace info
      const [workspace] = await this.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, invitation.workspaceId));

      if (!workspace) {
        return err(new Error('Workspace not found'));
      }

      // Get inviter info
      let inviter = null;
      if (invitation.invitedBy) {
        const [user] = await this.db
          .select()
          .from(users)
          .where(eq(users.id, invitation.invitedBy));
        inviter = user || null;
      }

      return ok({
        ...invitation,
        inviter,
        workspaceName: workspace.name,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}
