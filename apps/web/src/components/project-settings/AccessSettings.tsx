import { useEffect, useState } from 'react';
import { X, Plus, ShieldAlert, Lock, Globe } from 'lucide-react';
import type { ProjectAccess } from '@flowtask/shared';
import type { WorkspaceMemberDto as WorkspaceMember } from '../../api/types';
import { useProjectMembers, useSetProjectAccess, useWorkspaceMembers } from '../../hooks/queries';
import { IconButton, Popover, PopoverContent, PopoverTrigger, toast } from '../ui';

interface AccessSettingsProps {
  projectId: string;
  workspaceId: string;
  currentAccess: ProjectAccess;
}

export function AccessSettings({ projectId, workspaceId, currentAccess }: AccessSettingsProps) {
  const [access, setAccess] = useState<ProjectAccess>(currentAccess);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { data: projectMembers, isLoading: membersLoading } = useProjectMembers(projectId);
  const { data: workspaceMembers } = useWorkspaceMembers(workspaceId);
  const setProjectAccess = useSetProjectAccess(projectId);

  // Initialize selectedUserIds from project members
  useEffect(() => {
    setAccess(currentAccess);
  }, [currentAccess]);

  useEffect(() => {
    if (projectMembers) {
      setSelectedUserIds(new Set(projectMembers.map((m) => m.userId)));
    }
  }, [projectMembers]);

  const save = () =>
    setProjectAccess.mutate(
      { access, userIds: access === 'members' ? Array.from(selectedUserIds) : undefined },
      { onSuccess: () => toast.success('Access settings saved') }
    );

  const addMember = (userId: string) => {
    setSelectedUserIds((prev) => new Set([...prev, userId]));
    setShowMemberPicker(false);
    setSearchQuery('');
  };

  const removeMember = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  // Filter workspace members for the picker (exclude already selected and admins/owners)
  const availableMembers = (workspaceMembers || []).filter(
    (m: WorkspaceMember) =>
      !selectedUserIds.has(m.userId) &&
      m.role === 'member' &&
      (searchQuery === '' ||
        m.user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.user.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Get selected member details from workspace members
  const selectedMemberDetails = (workspaceMembers || []).filter((m: WorkspaceMember) =>
    selectedUserIds.has(m.userId)
  );

  if (membersLoading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-20 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  const hasChanges =
    access !== currentAccess ||
    (access === 'members' &&
      !setsEqual(selectedUserIds, new Set((projectMembers || []).map((m) => m.userId))));

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Project Access</h3>
        <p className="text-sm text-gray-500 mb-6">Control who can see and access this project.</p>

        {/* Access mode radio group */}
        <div className="space-y-3">
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              access === 'all'
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="access"
              value="all"
              checked={access === 'all'}
              onChange={() => setAccess('all')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Globe aria-hidden className="w-4 h-4 text-gray-600" />
                <span className="font-medium text-gray-900">All workspace members</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Everyone in the workspace can access this project.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              access === 'admin'
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="access"
              value="admin"
              checked={access === 'admin'}
              onChange={() => setAccess('admin')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <ShieldAlert aria-hidden className="w-4 h-4 text-gray-600" />
                <span className="font-medium text-gray-900">Admins only</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Only workspace owners and admins can access this project.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              access === 'members'
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="access"
              value="members"
              checked={access === 'members'}
              onChange={() => setAccess('members')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Lock aria-hidden className="w-4 h-4 text-gray-600" />
                <span className="font-medium text-gray-900">Specific members</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Only selected members (plus owners and admins) can access this project.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Member list (only shown for 'members' mode) */}
      {access === 'members' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-900">Allowed Members</h4>
            <Popover open={showMemberPicker} onOpenChange={setShowMemberPicker}>
              <PopoverTrigger asChild>
                <button type="button" className="btn btn-secondary text-sm flex items-center gap-1">
                  <Plus aria-hidden className="w-4 h-4" />
                  Add member
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 !p-0" aria-label="Add a member">
                <div className="p-2">
                  <label htmlFor="access-member-search" className="sr-only">
                    Search members
                  </label>
                  <input
                    id="access-member-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search members..."
                    className="input text-sm w-full"
                  />
                </div>
                <ul className="max-h-48 overflow-y-auto border-t border-gray-100">
                  {availableMembers.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">No members available</li>
                  ) : (
                    availableMembers.map((member: WorkspaceMember) => (
                      <li key={member.userId}>
                        <button
                          type="button"
                          onClick={() => addMember(member.userId)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 transition-colors text-left"
                        >
                          {member.user.avatarUrl ? (
                            <img
                              src={member.user.avatarUrl}
                              alt=""
                              className="w-6 h-6 rounded-full"
                            />
                          ) : (
                            <div
                              aria-hidden
                              className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs font-medium text-primary-700"
                            >
                              {member.user.name?.[0] || member.user.email[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {member.user.name || member.user.email.split('@')[0]}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{member.user.email}</p>
                          </div>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </PopoverContent>
            </Popover>
          </div>

          {selectedMemberDetails.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No members added yet. Add members to grant them access.
            </p>
          ) : (
            <div className="space-y-2">
              {selectedMemberDetails.map((member: WorkspaceMember) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    {member.user.avatarUrl ? (
                      <img src={member.user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-sm font-medium text-primary-700">
                        {member.user.name?.[0] || member.user.email[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {member.user.name || member.user.email.split('@')[0]}
                      </p>
                      <p className="text-xs text-gray-500">{member.user.email}</p>
                    </div>
                  </div>
                  <IconButton
                    label={`Remove ${member.user.name || member.user.email}`}
                    variant="danger"
                    icon={<X />}
                    onClick={() => removeMember(member.userId)}
                  />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4">
            Workspace owners and admins always have access regardless of this setting.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={setProjectAccess.isPending || !hasChanges}
          className="btn btn-primary"
        >
          {setProjectAccess.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}
