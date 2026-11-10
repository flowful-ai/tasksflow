import { useEffect, useState } from 'react';
import { X, Plus, ShieldAlert, Lock, Globe, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { ProjectAccess } from '@flowtask/shared';
import type { WorkspaceMemberDto as WorkspaceMember } from '../../api/types';
import { useProjectMembers, useSetProjectAccess, useWorkspaceMembers } from '../../hooks/queries';
import {
  Avatar,
  Button,
  Card,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from '../ui';

interface AccessSettingsProps {
  projectId: string;
  workspaceId: string;
  currentAccess: ProjectAccess;
}

const ACCESS_OPTIONS: ReadonlyArray<{
  value: ProjectAccess;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: 'all',
    title: 'All workspace members',
    description: 'Everyone in the workspace can access this project.',
    icon: Globe,
  },
  {
    value: 'admin',
    title: 'Admins only',
    description: 'Only workspace owners and admins can access this project.',
    icon: ShieldAlert,
  },
  {
    value: 'members',
    title: 'Specific members',
    description: 'Only selected members (plus owners and admins) can access this project.',
    icon: Lock,
  },
];

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
      <Card>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-neutral-200 rounded w-1/3" />
          <div className="h-20 bg-neutral-200 rounded" />
        </div>
      </Card>
    );
  }

  const hasChanges =
    access !== currentAccess ||
    (access === 'members' &&
      !setsEqual(selectedUserIds, new Set((projectMembers || []).map((m) => m.userId))));

  return (
    <div className="space-y-6">
      <Card title="Project Access" description="Control who can see and access this project.">
        {/* Access mode radio group */}
        <div className="space-y-3 pt-2">
          {ACCESS_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <label
                key={option.value}
                className={clsx(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  access === option.value
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-neutral-200 hover:border-neutral-300'
                )}
              >
                <input
                  type="radio"
                  name="access"
                  value={option.value}
                  checked={access === option.value}
                  onChange={() => setAccess(option.value)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon aria-hidden className="w-4 h-4 text-neutral-600" />
                    <span className="font-medium text-neutral-900">{option.title}</span>
                  </div>
                  <p className="text-sm text-neutral-500 mt-0.5">{option.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Member list (only shown for 'members' mode) */}
      {access === 'members' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-neutral-900">Allowed Members</h4>
            <Popover open={showMemberPicker} onOpenChange={setShowMemberPicker}>
              <PopoverTrigger asChild>
                <Button variant="secondary" leadingIcon={<Plus />}>
                  Add member
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 !p-0" aria-label="Add a member">
                <div className="p-2">
                  <Input
                    aria-label="Search members"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search members..."
                    className="text-sm"
                  />
                </div>
                <ul className="max-h-48 overflow-y-auto border-t border-neutral-100">
                  {availableMembers.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-neutral-500">No members available</li>
                  ) : (
                    availableMembers.map((member: WorkspaceMember) => (
                      <li key={member.userId}>
                        <button
                          type="button"
                          onClick={() => addMember(member.userId)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 focus:bg-neutral-50 transition-colors text-left"
                        >
                          <Avatar
                            src={member.user.avatarUrl}
                            name={member.user.name}
                            email={member.user.email}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-900 truncate">
                              {member.user.name || member.user.email.split('@')[0]}
                            </p>
                            <p className="text-xs text-neutral-500 truncate">{member.user.email}</p>
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
            <p className="text-sm text-neutral-500 py-4 text-center">
              No members added yet. Add members to grant them access.
            </p>
          ) : (
            <div className="space-y-2">
              {selectedMemberDetails.map((member: WorkspaceMember) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-neutral-50"
                >
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={member.user.avatarUrl}
                      name={member.user.name}
                      email={member.user.email}
                      size="lg"
                    />
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {member.user.name || member.user.email.split('@')[0]}
                      </p>
                      <p className="text-xs text-neutral-500">{member.user.email}</p>
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

          <p className="text-xs text-neutral-400 mt-4">
            Workspace owners and admins always have access regardless of this setting.
          </p>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={setProjectAccess.isPending || !hasChanges}>
          {setProjectAccess.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
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
