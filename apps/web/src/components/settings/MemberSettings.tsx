import { useState } from 'react';
import {
  Users,
  Mail,
  Crown,
  Shield,
  User,
  MoreHorizontal,
  Trash2,
  Copy,
  Check,
  Clock,
  X,
  UserPlus,
  Link as LinkIcon,
} from 'lucide-react';
import clsx from 'clsx';
import {
  useCurrentWorkspace,
  useInvitationMutations,
  useInvitations,
  useRemoveMember,
  useTransferOwnership,
  useUpdateMemberRole,
  useWorkspaceMembers,
} from '../../hooks/queries';
import { useAuthStore } from '../../stores/auth';
import type { WorkspaceMemberDto as WorkspaceMember, WorkspaceRole } from '../../api/types';
import type { WorkspaceInvitation } from '../../api/workspaces';
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  IconButton,
  toast,
} from '../ui';
import { InviteMemberDialog } from './InviteMemberDialog';

type PendingAction =
  | { type: 'remove'; member: WorkspaceMember }
  | { type: 'transfer'; member: WorkspaceMember }
  | null;

function memberName(member: WorkspaceMember): string {
  return member.user.name || member.user.email.split('@')[0] || member.user.email;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

function RoleIcon({ role }: { role: WorkspaceRole }) {
  if (role === 'owner') return <Crown aria-hidden className="w-4 h-4 text-amber-500" />;
  if (role === 'admin') return <Shield aria-hidden className="w-4 h-4 text-blue-500" />;
  return <User aria-hidden className="w-4 h-4 text-neutral-400" />;
}

interface MemberRowProps {
  member: WorkspaceMember;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  onUpdateRole: (userId: string, role: 'admin' | 'member') => void;
  onRequest: (action: NonNullable<PendingAction>) => void;
  isUpdating: boolean;
}

function MemberRow({
  member,
  currentUserId,
  currentUserRole,
  onUpdateRole,
  onRequest,
  isUpdating,
}: MemberRowProps) {
  const isCurrentUser = member.userId === currentUserId;
  const canManage =
    (currentUserRole === 'owner' || currentUserRole === 'admin') &&
    member.role !== 'owner' &&
    !isCurrentUser;
  const canTransfer = currentUserRole === 'owner' && !isCurrentUser;

  return (
    <li className="flex items-center justify-between py-3 px-4 hover:bg-neutral-50 rounded-lg">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-600 font-medium"
        >
          {member.user.avatarUrl ? (
            <img src={member.user.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
          ) : (
            <span>{(member.user.name || member.user.email).charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">{memberName(member)}</span>
            {isCurrentUser && (
              <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded">You</span>
            )}
          </div>
          <div className="text-sm text-neutral-500">{member.user.email}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm">
          <RoleIcon role={member.role} />
          <span className="text-neutral-600">{ROLE_LABELS[member.role]}</span>
        </div>

        {(canManage || canTransfer) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={`Actions for ${memberName(member)}`}
                icon={<MoreHorizontal />}
                disabled={isUpdating}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage && member.role === 'member' && (
                <DropdownMenuItem
                  icon={<Shield />}
                  onSelect={() => onUpdateRole(member.userId, 'admin')}
                >
                  Make admin
                </DropdownMenuItem>
              )}
              {canManage && member.role === 'admin' && (
                <DropdownMenuItem
                  icon={<User />}
                  onSelect={() => onUpdateRole(member.userId, 'member')}
                >
                  Make member
                </DropdownMenuItem>
              )}
              {canTransfer && (
                <DropdownMenuItem
                  icon={<Crown />}
                  onSelect={() => onRequest({ type: 'transfer', member })}
                >
                  Transfer ownership
                </DropdownMenuItem>
              )}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    icon={<Trash2 />}
                    onSelect={() => onRequest({ type: 'remove', member })}
                  >
                    Remove from workspace
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

interface InvitationRowProps {
  invitation: WorkspaceInvitation;
  onRevoke: (invitationId: string) => void;
  isRevoking: boolean;
}

function InvitationRow({ invitation, onRevoke, isRevoking }: InvitationRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(invitation.inviteUrl);
    } catch {
      toast.error('Could not copy the link');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isExpired = new Date(invitation.expiresAt) < new Date();
  const isGeneric = invitation.email === null;
  const isExhausted = invitation.status === 'exhausted';
  const usage =
    invitation.maxUses === null
      ? `${invitation.usesCount} uses`
      : `${invitation.usesCount}/${invitation.maxUses} uses`;

  return (
    <li
      className={clsx(
        'flex items-center justify-between py-3 px-4 rounded-lg',
        isExpired
          ? 'bg-amber-50'
          : isExhausted
            ? 'bg-neutral-100'
            : isGeneric
              ? 'bg-purple-50'
              : 'bg-blue-50'
      )}
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className={clsx(
            'w-10 h-10 rounded-full flex items-center justify-center',
            isGeneric ? 'bg-purple-100' : 'bg-neutral-200'
          )}
        >
          {isGeneric ? (
            <LinkIcon className="w-5 h-5 text-purple-600" />
          ) : (
            <Mail className="w-5 h-5 text-neutral-500" />
          )}
        </div>
        <div>
          <div className="font-medium text-neutral-900">
            {isGeneric ? 'Generic invite link' : invitation.email}
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            {isExhausted ? (
              <span className="flex items-center gap-1">
                <X aria-hidden className="w-3 h-3" />
                Exhausted
              </span>
            ) : isExpired ? (
              <span className="text-amber-700 flex items-center gap-1">
                <Clock aria-hidden className="w-3 h-3" />
                Expired
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Clock aria-hidden className="w-3 h-3" />
                Expires {new Date(invitation.expiresAt).toLocaleDateString()}
              </span>
            )}
            <span aria-hidden>•</span>
            <span>{invitation.role === 'admin' ? 'Admin' : 'Member'}</span>
            {isGeneric && (
              <>
                <span aria-hidden>•</span>
                <span className={clsx(!isExhausted && 'text-purple-700')}>{usage}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleCopyLink()}
          disabled={isExpired || isExhausted}
          className={clsx(
            'btn btn-secondary text-sm',
            copied && 'bg-green-100 text-green-700 border-green-200'
          )}
        >
          {copied ? (
            <Check aria-hidden className="w-4 h-4 mr-1" />
          ) : (
            <Copy aria-hidden className="w-4 h-4 mr-1" />
          )}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={() => onRevoke(invitation.id)}
          disabled={isRevoking}
          className="btn btn-secondary text-sm text-red-600 hover:bg-red-50"
        >
          <X aria-hidden className="w-4 h-4 mr-1" />
          Revoke
        </button>
      </div>
    </li>
  );
}

export function MemberSettings() {
  const { workspace } = useCurrentWorkspace();
  const workspaceId = workspace?.id ?? '';
  const currentUserId = useAuthStore((state) => state.user?.id ?? '');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);

  const { data: members = [], isLoading, error, refetch } = useWorkspaceMembers(workspace?.id);
  const currentUserRole: WorkspaceRole =
    members.find((m) => m.userId === currentUserId)?.role ?? 'member';
  const canManageMembers = currentUserRole === 'owner' || currentUserRole === 'admin';
  const { data: invitations = [] } = useInvitations(workspace?.id, canManageMembers);

  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const transferOwnership = useTransferOwnership(workspaceId);
  const { revoke } = useInvitationMutations(workspaceId);

  if (isLoading) {
    return (
      <div className="card p-6" aria-busy>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-neutral-200 rounded w-1/3" />
          <div className="h-4 bg-neutral-200 rounded w-2/3" />
          <div className="space-y-3 mt-6">
            <div className="h-16 bg-neutral-100 rounded" />
            <div className="h-16 bg-neutral-100 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <ErrorState error={error} resource="member list" onRetry={() => void refetch()} />
      </div>
    );
  }

  const confirmPending = async () => {
    if (!pending) return;
    const name = memberName(pending.member);
    if (pending.type === 'remove') {
      await removeMember.mutateAsync(pending.member.userId);
      toast.success(`${name} was removed from the workspace`);
    } else {
      await transferOwnership.mutateAsync(pending.member.userId);
      toast.success(`${name} is now the owner`);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-6" aria-labelledby="members-heading">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              id="members-heading"
              className="text-lg font-semibold text-neutral-900 flex items-center gap-2"
            >
              <Users aria-hidden className="w-5 h-5" />
              Team Members
            </h2>
            <p className="text-sm text-neutral-600 mt-1">Manage who has access to this workspace.</p>
          </div>
          {canManageMembers && (
            <button
              type="button"
              onClick={() => setShowInviteDialog(true)}
              className="btn btn-primary"
            >
              <UserPlus aria-hidden className="w-4 h-4 mr-2" />
              Invite
            </button>
          )}
        </div>

        <ul className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onUpdateRole={(userId, role) =>
                updateRole.mutate(
                  { userId, role },
                  { onSuccess: () => toast.success('Role updated') }
                )
              }
              onRequest={setPending}
              isUpdating={
                updateRole.isPending || removeMember.isPending || transferOwnership.isPending
              }
            />
          ))}
        </ul>
      </section>

      {canManageMembers && invitations.length > 0 && (
        <section className="card p-6" aria-labelledby="invitations-heading">
          <h3
            id="invitations-heading"
            className="text-base font-semibold text-neutral-900 mb-4 flex items-center gap-2"
          >
            <UserPlus aria-hidden className="w-5 h-5" />
            Open Invitations
          </h3>
          <ul className="space-y-3">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                onRevoke={(id) =>
                  revoke.mutate(id, { onSuccess: () => toast.success('Invitation revoked') })
                }
                isRevoking={revoke.isPending}
              />
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        variant={pending?.type === 'remove' ? 'danger' : 'default'}
        title={
          pending?.type === 'transfer'
            ? `Transfer ownership to ${pending ? memberName(pending.member) : ''}?`
            : `Remove ${pending ? memberName(pending.member) : ''}?`
        }
        description={
          pending?.type === 'transfer'
            ? 'They become the workspace owner and you become an admin. Only the new owner can transfer it back.'
            : 'They lose access to every project in this workspace. You can invite them again later.'
        }
        confirmLabel={pending?.type === 'transfer' ? 'Transfer ownership' : 'Remove'}
        onConfirm={confirmPending}
      />

      {showInviteDialog && workspace && (
        <InviteMemberDialog
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          onClose={() => setShowInviteDialog(false)}
          onInvited={() => setShowInviteDialog(false)}
        />
      )}
    </div>
  );
}
