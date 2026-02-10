import { useState } from 'react';
import {
  Share2,
  Globe,
  Lock,
  Copy,
  Check,
  Calendar,
  Trash2,
  X,
  Hash,
  Link as LinkIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import clsx from 'clsx';

// Public share type matching the database schema
export interface PublicShare {
  id: string;
  smartViewId: string;
  token: string;
  displayTypeOverride: string | null;
  hideFields: string[] | null;
  passwordHash: string | null;
  expiresAt: string | null;
  maxAccessCount: number | null;
  accessCount: number;
  lastAccessedAt: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

interface ShareButtonProps {
  hasActiveShares: boolean;
  onClick: () => void;
}

export function ShareButton({ hasActiveShares, onClick }: ShareButtonProps) {
  return (
    <button
      onClick={onClick}
      className="btn btn-secondary inline-flex items-center relative"
      title={hasActiveShares ? 'Manage public share' : 'Create public share'}
    >
      <Share2 className="w-4 h-4 mr-2" />
      Share
      {hasActiveShares && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
      )}
    </button>
  );
}

interface ActiveShareBannerProps {
  shareUrl: string;
  hasPassword: boolean;
  expiresAt: string | null;
  accessCount: number;
  maxAccessCount: number | null;
  onManage: () => void;
}

export function ActiveShareBanner({
  shareUrl,
  hasPassword,
  expiresAt,
  accessCount,
  maxAccessCount,
  onManage,
}: ActiveShareBannerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  const isMaxedOut = maxAccessCount !== null && accessCount >= maxAccessCount;

  return (
    <div
      className={clsx(
        'flex items-center justify-between px-4 py-3 rounded-lg mb-4',
        isExpired || isMaxedOut
          ? 'bg-amber-50 border border-amber-200'
          : 'bg-blue-50 border border-blue-200'
      )}
    >
      <div className="flex items-center gap-3">
        <Globe
          className={clsx(
            'w-5 h-5',
            isExpired || isMaxedOut ? 'text-amber-600' : 'text-blue-600'
          )}
        />
        <div>
          <span
            className={clsx(
              'font-medium',
              isExpired || isMaxedOut ? 'text-amber-800' : 'text-blue-800'
            )}
          >
            {isExpired
              ? 'Public share expired'
              : isMaxedOut
                ? 'Access limit reached'
                : 'This view is publicly shared'}
          </span>
          <div className="flex items-center gap-3 text-sm text-gray-600 mt-0.5">
            {hasPassword && (
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Password protected
              </span>
            )}
            {maxAccessCount && (
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {accessCount}/{maxAccessCount} views
              </span>
            )}
            {expiresAt && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {isExpired ? 'Expired' : `Expires ${new Date(expiresAt).toLocaleDateString()}`}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className={clsx(
            'btn btn-secondary text-sm',
            copied && 'bg-green-100 text-green-700 border-green-200'
          )}
          disabled={isExpired || isMaxedOut}
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
        <button onClick={onManage} className="btn btn-secondary text-sm">
          Manage
        </button>
      </div>
    </div>
  );
}

interface ShareDialogProps {
  viewName: string;
  publicShares: PublicShare[];
  isCreating: boolean;
  isDisabling: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onCreate: (data: CreateShareData) => void;
  onDisable: (shareId: string) => void;
  onDelete: (shareId: string) => void;
}

export interface CreateShareData {
  password?: string;
  expiresAt?: string;
  maxAccessCount?: number;
}

export function ShareDialog({
  viewName,
  publicShares,
  isCreating,
  isDisabling,
  isDeleting,
  onClose,
  onCreate,
  onDisable,
  onDelete,
}: ShareDialogProps) {
  const [showCreateForm, setShowCreateForm] = useState(publicShares.length === 0);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [maxAccessCount, setMaxAccessCount] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeShares = publicShares.filter((s) => s.isActive);
  const inactiveShares = publicShares.filter((s) => !s.isActive);

  const handleCreate = () => {
    const data: CreateShareData = {};
    if (password.trim()) {
      data.password = password.trim();
    }
    if (expiresAt) {
      data.expiresAt = expiresAt;
    }
    if (maxAccessCount && parseInt(maxAccessCount, 10) > 0) {
      data.maxAccessCount = parseInt(maxAccessCount, 10);
    }
    onCreate(data);
  };

  const handleCopyLink = async (token: string, shareId: string) => {
    const url = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(shareId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getShareUrl = (token: string) => `${window.location.origin}/share/${token}`;

  const isShareExpired = (share: PublicShare) =>
    share.expiresAt ? new Date(share.expiresAt) < new Date() : false;

  const isShareMaxedOut = (share: PublicShare) =>
    share.maxAccessCount !== null && share.accessCount >= share.maxAccessCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-lg shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Share "{viewName}"</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Active shares list */}
          {activeShares.length > 0 && !showCreateForm && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700">Active shares</h3>
              {activeShares.map((share) => {
                const expired = isShareExpired(share);
                const maxedOut = isShareMaxedOut(share);
                return (
                  <div
                    key={share.id}
                    className={clsx(
                      'p-3 rounded-lg border',
                      expired || maxedOut
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-green-50 border-green-200'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Globe
                            className={clsx(
                              'w-4 h-4',
                              expired || maxedOut ? 'text-amber-600' : 'text-green-600'
                            )}
                          />
                          <span className="text-sm font-medium text-gray-900">
                            {expired
                              ? 'Expired'
                              : maxedOut
                                ? 'Access limit reached'
                                : 'Public link'}
                          </span>
                          {share.passwordHash && (
                            <span title="Password protected">
                              <Lock className="w-3.5 h-3.5 text-gray-500" />
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                          <LinkIcon className="w-3 h-3" />
                          <span className="truncate max-w-[250px]">{getShareUrl(share.token)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {share.accessCount} view{share.accessCount !== 1 ? 's' : ''}
                            {share.maxAccessCount && ` / ${share.maxAccessCount} max`}
                          </span>
                          {share.expiresAt && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {expired
                                ? 'Expired'
                                : `Expires ${new Date(share.expiresAt).toLocaleDateString()}`}
                            </span>
                          )}
                          <span>Created {new Date(share.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-2">
                      <button
                        onClick={() => handleCopyLink(share.token, share.id)}
                        disabled={expired || maxedOut}
                        className={clsx(
                          'flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors',
                          copiedId === share.id
                            ? 'bg-green-100 text-green-700'
                            : 'text-gray-700 hover:bg-gray-100',
                          (expired || maxedOut) && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {copiedId === share.id ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy link
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => onDisable(share.id)}
                        disabled={isDisabling}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      >
                        <EyeOff className="w-4 h-4" />
                        Disable
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(share.id)}
                        disabled={isDeleting}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Inactive shares */}
          {inactiveShares.length > 0 && !showCreateForm && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-500">Disabled shares</h3>
              {inactiveShares.map((share) => (
                <div key={share.id} className="p-3 rounded-lg border bg-gray-50 border-gray-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-500">Disabled</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {share.accessCount} view{share.accessCount !== 1 ? 's' : ''} • Created{' '}
                        {new Date(share.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmDeleteId(share.id)}
                      disabled={isDeleting}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create form */}
          {showCreateForm && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Create a public link to share this view with anyone, even without a TasksFlow account.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Lock className="w-4 h-4 inline mr-1" />
                  Password (optional)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input pr-10"
                    placeholder="Leave empty for no password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Expiration date (optional)
                </label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Hash className="w-4 h-4 inline mr-1" />
                  Maximum access count (optional)
                </label>
                <input
                  type="number"
                  value={maxAccessCount}
                  onChange={(e) => setMaxAccessCount(e.target.value)}
                  min="1"
                  className="input"
                  placeholder="Leave empty for unlimited"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-3 p-4 border-t border-gray-200">
          {!showCreateForm && activeShares.length > 0 ? (
            <>
              <button
                onClick={() => setShowCreateForm(true)}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                + Create another link
              </button>
              <button onClick={onClose} className="btn btn-secondary">
                Close
              </button>
            </>
          ) : (
            <>
              {publicShares.length > 0 && (
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Back to shares
                </button>
              )}
              <div className="flex gap-3 ml-auto">
                <button onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="btn btn-primary"
                >
                  {isCreating ? 'Creating...' : 'Create share link'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDeleteId(null)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete share link</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete this share link? Anyone using this link will no longer
              be able to access the view.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
