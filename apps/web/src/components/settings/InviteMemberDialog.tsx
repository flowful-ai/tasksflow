import { useState } from 'react';
import { X, Mail, Shield, User, Copy, Check, Link as LinkIcon, Users } from 'lucide-react';
import clsx from 'clsx';
import { invitationApi, type WorkspaceInvitation } from '../../api/client';

interface InviteMemberDialogProps {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onInvited: () => void;
}

type InviteType = 'email' | 'generic';

const MAX_USES_OPTIONS = [
  { value: 1, label: '1 use' },
  { value: 5, label: '5 uses' },
  { value: 10, label: '10 uses' },
  { value: 25, label: '25 uses' },
  { value: null, label: 'Unlimited' },
] as const;

export function InviteMemberDialog({
  workspaceId,
  workspaceName,
  onClose,
  onInvited,
}: InviteMemberDialogProps) {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [inviteType, setInviteType] = useState<InviteType>('email');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [maxUses, setMaxUses] = useState<number | null>(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvitation, setCreatedInvitation] = useState<WorkspaceInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // For email invites, email is required
    if (inviteType === 'email' && !email.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await invitationApi.create(workspaceId, {
        email: inviteType === 'email' ? email.trim() : null,
        role,
        maxUses: inviteType === 'generic' ? maxUses : 1,
      });
      setCreatedInvitation(response.data);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!createdInvitation) return;
    await navigator.clipboard.writeText(createdInvitation.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInviteAnother = () => {
    setStep('form');
    setInviteType('email');
    setEmail('');
    setRole('member');
    setMaxUses(5);
    setCreatedInvitation(null);
    setCopied(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {step === 'form' ? 'Invite to Workspace' : 'Invitation Created'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {step === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">
                Invite someone to join <span className="font-medium">{workspaceName}</span>. They'll
                receive a link to accept the invitation.
              </p>

              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
              )}

              {/* Invite Type Toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Invite Type</label>
                <div className="flex rounded-lg border border-gray-200 p-1">
                  <button
                    type="button"
                    onClick={() => setInviteType('email')}
                    className={clsx(
                      'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                      inviteType === 'email'
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <Mail className="w-4 h-4" />
                    Email Invite
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteType('generic')}
                    className={clsx(
                      'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                      inviteType === 'generic'
                        ? 'bg-purple-100 text-purple-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <LinkIcon className="w-4 h-4" />
                    Generic Link
                  </button>
                </div>
              </div>

              {inviteType === 'email' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    placeholder="colleague@company.com"
                    required
                    autoFocus
                  />
                </div>
              ) : (
                <div className="bg-purple-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Users className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-purple-900">Generic Invite Link</p>
                      <p className="text-xs text-purple-700 mt-1">
                        Anyone with this link can join the workspace. Useful for team onboarding or events.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-900 mb-1">
                      Usage Limit
                    </label>
                    <select
                      value={maxUses === null ? 'unlimited' : maxUses}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMaxUses(val === 'unlimited' ? null : Number(val));
                      }}
                      className="input bg-white"
                    >
                      {MAX_USES_OPTIONS.map((opt) => (
                        <option
                          key={opt.value === null ? 'unlimited' : opt.value}
                          value={opt.value === null ? 'unlimited' : opt.value}
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole('member')}
                    className={clsx(
                      'p-3 rounded-lg border-2 text-left transition-colors',
                      role === 'member'
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4 text-gray-600" />
                      <span className="font-medium text-gray-900">Member</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Can view and edit tasks, create views
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('admin')}
                    className={clsx(
                      'p-3 rounded-lg border-2 text-left transition-colors',
                      role === 'admin'
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-blue-600" />
                      <span className="font-medium text-gray-900">Admin</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Full access including member management
                    </p>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || (inviteType === 'email' && !email.trim())}
                  className="btn btn-primary"
                >
                  {isSubmitting ? 'Creating...' : 'Create Invitation'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-2">
                <div className={clsx(
                  'w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3',
                  createdInvitation?.isGeneric ? 'bg-purple-100' : 'bg-green-100'
                )}>
                  {createdInvitation?.isGeneric ? (
                    <LinkIcon className="w-6 h-6 text-purple-600" />
                  ) : (
                    <Check className="w-6 h-6 text-green-600" />
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  {createdInvitation?.isGeneric ? (
                    'Generic invite link created'
                  ) : (
                    <>Invitation created for <span className="font-medium">{createdInvitation?.email}</span></>
                  )}
                </p>
              </div>

              <div className={clsx(
                'rounded-lg p-4',
                createdInvitation?.isGeneric ? 'bg-purple-50' : 'bg-gray-50'
              )}>
                <label className={clsx(
                  'block text-sm font-medium mb-2',
                  createdInvitation?.isGeneric ? 'text-purple-900' : 'text-gray-700'
                )}>
                  Invite Link
                </label>
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    'flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg text-sm overflow-hidden',
                    createdInvitation?.isGeneric
                      ? 'bg-white border-purple-200 text-purple-700'
                      : 'bg-white border-gray-200 text-gray-600'
                  )}>
                    <LinkIcon className={clsx(
                      'w-4 h-4 flex-shrink-0',
                      createdInvitation?.isGeneric ? 'text-purple-400' : 'text-gray-400'
                    )} />
                    <span className="truncate">{createdInvitation?.inviteUrl}</span>
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className={clsx(
                      'btn',
                      copied
                        ? 'bg-green-100 text-green-700 border-green-200'
                        : 'btn-secondary'
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
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <p className={clsx(
                  'text-xs mt-2',
                  createdInvitation?.isGeneric ? 'text-purple-700' : 'text-gray-500'
                )}>
                  {createdInvitation?.isGeneric ? (
                    <>
                      {createdInvitation.maxUses === null
                        ? 'Unlimited uses'
                        : `Can be used ${createdInvitation.maxUses} time${createdInvitation.maxUses === 1 ? '' : 's'}`}.
                      {' '}The link expires in 7 days.
                    </>
                  ) : (
                    <>Share this link with {createdInvitation?.email}. The link expires in 7 days.</>
                  )}
                </p>
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={handleInviteAnother}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  + Create another invite
                </button>
                <button
                  onClick={() => {
                    onInvited();
                    onClose();
                  }}
                  className="btn btn-primary"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
