import { useState, useEffect } from 'react';
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
import { useWorkspaceStore } from '../../stores/workspace';
import { useAuthStore } from '../../stores/auth';
import {
  memberApi,
  invitationApi,
  type WorkspaceMember,
  type WorkspaceInvitation,
} from '../../api/client';
import { InviteMemberDialog } from './InviteMemberDialog';

interface MemberRowProps {
  member: WorkspaceMember;
  currentUserId: string;
  currentUserRole: 'owner' | 'admin' | 'member';
  onUpdateRole: (memberId: string, role: 'admin' | 'member') => void;
  onRemove: (memberId: string) => void;
  isUpdating: boolean;
}

function MemberRow({
  member,
  currentUserId,
  currentUserRole,
  onUpdateRole,
  onRemove,
  isUpdating,
}: MemberRowProps) {
  const [showMenu, setShowMenu] = useState(false);

  const isCurrentUser = member.userId === currentUserId;
  const canManage =
    (currentUserRole === 'owner' || currentUserRole === 'admin') &&
    member.role !== 'owner' &&
    !isCurrentUser;

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4 text-amber-500" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-blue-500" />;
      default:
        return <User className="w-4 h-4 text-gray-400" />;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner':
        return 'Owner';
      case 'admin':
        return 'Admin';
      default:
        return 'Member';
    }
  };

  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-gray-50 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
          {member.user.avatarUrl ? (
            <img
              src={member.user.avatarUrl}
              alt={member.user.name || member.user.email}
              className="w-10 h-10 rounded-full"
            />
          ) : (
            <span>{(member.user.name || member.user.email).charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">
              {member.user.name || member.user.email.split('@')[0]}
            </span>
            {isCurrentUser && (
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">You</span>
            )}
          </div>
          <div className="text-sm text-gray-500">{member.user.email}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm">
          {getRoleIcon(member.role)}
          <span className="text-gray-600">{getRoleLabel(member.role)}</span>
        </div>

        {canManage && (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={isUpdating}
            >
              <MoreHorizontal className="w-4 h-4 text-gray-500" />
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {member.role === 'member' && (
                    <button
                      onClick={() => {
                        onUpdateRole(member.userId, 'admin');
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <Shield className="w-4 h-4" />
                      Make Admin
                    </button>
                  )}
                  {member.role === 'admin' && (
                    <button
                      onClick={() => {
                        onUpdateRole(member.userId, 'member');
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <User className="w-4 h-4" />
                      Make Member
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onRemove(member.userId);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
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
    await navigator.clipboard.writeText(invitation.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isExpired = new Date(invitation.expiresAt) < new Date();
  const isGeneric = invitation.email === null;
  const isExhausted = invitation.status === 'exhausted';

  // Format usage display
  const getUsageDisplay = () => {
    if (invitation.maxUses === null) {
      return `${invitation.usesCount} uses`;
    }
    return `${invitation.usesCount}/${invitation.maxUses} uses`;
  };

  return (
    <div
      className={clsx(
        'flex items-center justify-between py-3 px-4 rounded-lg',
        isExpired ? 'bg-amber-50' :
        isExhausted ? 'bg-gray-100' :
        isGeneric ? 'bg-purple-50' : 'bg-blue-50'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center',
          isGeneric ? 'bg-purple-100' : 'bg-gray-200'
        )}>
          {isGeneric ? (
            <LinkIcon className="w-5 h-5 text-purple-600" />
          ) : (
            <Mail className="w-5 h-5 text-gray-500" />
          )}
        </div>
        <div>
          <div className="font-medium text-gray-900">
            {isGeneric ? 'Generic invite link' : invitation.email}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {isExhausted ? (
              <span className="text-gray-500 flex items-center gap-1">
                <X className="w-3 h-3" />
                Exhausted
              </span>
            ) : isExpired ? (
              <span className="text-amber-600 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Expired
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Expires {new Date(invitation.expiresAt).toLocaleDateString()}
              </span>
            )}
            <span>•</span>
            <span>{invitation.role === 'admin' ? 'Admin' : 'Member'}</span>
            {isGeneric && (
              <>
                <span>•</span>
                <span className={clsx(
                  isExhausted && 'text-gray-500',
                  !isExhausted && 'text-purple-600'
                )}>
                  {getUsageDisplay()}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleCopyLink}
          disabled={isExpired || isExhausted}
          className={clsx(
            'btn btn-secondary text-sm',
            copied && 'bg-green-100 text-green-700 border-green-200',
            (isExpired || isExhausted) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-1" />
              Copy link
            </>
          )}
        </button>
        <button
          onClick={() => onRevoke(invitation.id)}
          disabled={isRevoking}
          className="btn btn-secondary text-sm text-red-600 hover:bg-red-50"
        >
          <X className="w-4 h-4 mr-1" />
          Revoke
        </button>
      </div>
    </div>
  );
}

export function MemberSettings() {
  const workspace = useWorkspaceStore((state) => state.currentWorkspace);
  const currentUser = useAuthStore((state) => state.user);

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const currentMember = members.find((m) => m.userId === currentUser?.id);
  const currentUserRole = currentMember?.role || 'member';
  const canManageMembers = currentUserRole === 'owner' || currentUserRole === 'admin';

  const loadData = async () => {
    if (!workspace) return;

    setIsLoading(true);
    setError(null);

    try {
      const [membersRes, invitationsRes] = await Promise.all([
        memberApi.list(workspace.id),
        canManageMembers ? invitationApi.list(workspace.id, 'pending') : Promise.resolve({ data: [] }),
      ]);

      setMembers(membersRes.data);
      setInvitations(invitationsRes.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [workspace?.id]);

  const handleUpdateRole = async (memberId: string, role: 'admin' | 'member') => {
    if (!workspace) return;

    setIsUpdating(true);
    try {
      await memberApi.updateRole(workspace.id, memberId, role);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!workspace) return;

    setIsUpdating(true);
    try {
      await memberApi.remove(workspace.id, memberId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!workspace) return;

    setIsRevoking(true);
    try {
      await invitationApi.revoke(workspace.id, invitationId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleInvitationCreated = () => {
    setShowInviteDialog(false);
    loadData();
  };

  if (isLoading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          <div className="space-y-3 mt-6">
            <div className="h-16 bg-gray-100 rounded"></div>
            <div className="h-16 bg-gray-100 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Team Members
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Manage who has access to this workspace.
            </p>
          </div>
          {canManageMembers && (
            <button onClick={() => setShowInviteDialog(true)} className="btn btn-primary">
              <UserPlus className="w-4 h-4 mr-2" />
              Invite
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
        )}

        {/* Members list */}
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              currentUserId={currentUser?.id || ''}
              currentUserRole={currentUserRole}
              onUpdateRole={handleUpdateRole}
              onRemove={handleRemoveMember}
              isUpdating={isUpdating}
            />
          ))}
        </div>
      </div>

      {/* Pending invitations */}
      {canManageMembers && invitations.length > 0 && (
        <div className="card p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Open Invitations
          </h3>
          <div className="space-y-3">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                onRevoke={handleRevokeInvitation}
                isRevoking={isRevoking}
              />
            ))}
          </div>
        </div>
      )}

      {/* Invite dialog */}
      {showInviteDialog && workspace && (
        <InviteMemberDialog
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          onClose={() => setShowInviteDialog(false)}
          onInvited={handleInvitationCreated}
        />
      )}
    </div>
  );
}
