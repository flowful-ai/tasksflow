import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, Plus, ShieldAlert, Lock, Globe } from 'lucide-react';
import { api, memberApi } from '../../api/client';
import type { WorkspaceMember } from '../../api/client';

interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

interface AccessSettingsProps {
  projectId: string;
  workspaceId: string;
  currentAccess: 'all' | 'admin' | 'members';
  onUpdated: () => void;
}

export function AccessSettings({ projectId, workspaceId, currentAccess, onUpdated }: AccessSettingsProps) {
  const [access, setAccess] = useState<'all' | 'admin' | 'members'>(currentAccess);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch current project members
  const { data: projectMembers, isLoading: membersLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: ProjectMember[] }>(
        `/api/projects/${projectId}/members`
      );
      return response.data;
    },
  });

  // Fetch workspace members for the picker
  const { data: workspaceMembers } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: async () => {
      const response = await memberApi.list(workspaceId);
      return response.data;
    },
  });

  // Initialize selectedUserIds from project members
  useEffect(() => {
    setAccess(currentAccess);
  }, [currentAccess]);

  useEffect(() => {
    if (projectMembers) {
      setSelectedUserIds(new Set(projectMembers.map((m) => m.userId)));
    }
  }, [projectMembers]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return api.put(`/api/projects/${projectId}/members`, {
        access,
        userIds: access === 'members' ? Array.from(selectedUserIds) : undefined,
      });
    },
    onSuccess: () => {
      setError(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

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

  const hasChanges = access !== currentAccess ||
    (access === 'members' && !setsEqual(selectedUserIds, new Set((projectMembers || []).map((m) => m.userId))));

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Project Access</h3>
        <p className="text-sm text-gray-500 mb-6">
          Control who can see and access this project.
        </p>

        {/* Access mode radio group */}
        <div className="space-y-3">
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              access === 'all' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
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
                <Globe className="w-4 h-4 text-gray-600" />
                <span className="font-medium text-gray-900">All workspace members</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Everyone in the workspace can access this project.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              access === 'admin' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
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
                <ShieldAlert className="w-4 h-4 text-gray-600" />
                <span className="font-medium text-gray-900">Admins only</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Only workspace owners and admins can access this project.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              access === 'members' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
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
                <Lock className="w-4 h-4 text-gray-600" />
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
            <div className="relative">
              <button
                onClick={() => setShowMemberPicker(!showMemberPicker)}
                className="btn btn-secondary text-sm flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Add member
              </button>

              {showMemberPicker && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                  <div className="p-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search members..."
                      className="input text-sm w-full"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto border-t border-gray-100">
                    {availableMembers.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-500">No members available</p>
                    ) : (
                      availableMembers.map((member: WorkspaceMember) => (
                        <button
                          key={member.userId}
                          onClick={() => addMember(member.userId)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                        >
                          {member.user.avatarUrl ? (
                            <img src={member.user.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs font-medium text-primary-700">
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
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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
                  <button
                    onClick={() => removeMember(member.userId)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4">
            Workspace owners and admins always have access regardless of this setting.
          </p>
        </div>
      )}

      {/* Save button */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg p-3">
          Access settings saved successfully.
        </div>
      )}
      <div className="flex justify-end">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !hasChanges}
          className="btn btn-primary"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
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
