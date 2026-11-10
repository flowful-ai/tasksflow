import { useState } from 'react';
import {
  Share2,
  Globe,
  Lock,
  Copy,
  Check,
  Calendar,
  Trash2,
  GitBranch,
  Hash,
  Link as LinkIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import clsx from 'clsx';

import type { CreatePublicShareInput, PublicShareDto } from '../../api/types';
import { Button, Checkbox, ConfirmDialog, Dialog, Field, IconButton, Input, Panel } from '../ui';

/** A public share as returned to its owner. */
export type PublicShare = PublicShareDto;

interface ShareButtonProps {
  hasActiveShares: boolean;
  onClick: () => void;
}

export function ShareButton({ hasActiveShares, onClick }: ShareButtonProps) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      className="relative"
      title={hasActiveShares ? 'Manage public share' : 'Create public share'}
      leadingIcon={<Share2 />}
    >
      Share
      {hasActiveShares && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
      )}
    </Button>
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
          className={clsx('w-5 h-5', isExpired || isMaxedOut ? 'text-amber-600' : 'text-blue-600')}
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
          <div className="flex items-center gap-3 text-sm text-neutral-600 mt-0.5">
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
        <Button
          variant="secondary"
          onClick={handleCopy}
          className={clsx(copied && 'bg-green-100 text-green-700 border-green-200')}
          disabled={isExpired || isMaxedOut}
          leadingIcon={copied ? <Check /> : <Copy />}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button variant="secondary" onClick={onManage}>
          Manage
        </Button>
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

/** What the create form submits (a subset of CreatePublicShareInput). */
export type CreateShareData = Pick<
  CreatePublicShareInput,
  'password' | 'expiresAt' | 'maxAccessCount' | 'showExternalLinks'
>;

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
  const [showExternalLinks, setShowExternalLinks] = useState(false);
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
    if (showExternalLinks) {
      data.showExternalLinks = true;
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
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={
          <span className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-neutral-600" aria-hidden />
            Share "{viewName}"
          </span>
        }
        size="lg"
        bodyClassName="space-y-4"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {!showCreateForm && activeShares.length > 0 ? (
              <>
                <Button variant="link" onClick={() => setShowCreateForm(true)}>
                  + Create another link
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
              </>
            ) : (
              <>
                {publicShares.length > 0 && (
                  <Button variant="link-muted" onClick={() => setShowCreateForm(false)}>
                    Back to shares
                  </Button>
                )}
                <div className="flex gap-3 ml-auto">
                  <Button variant="secondary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={isCreating}>
                    {isCreating ? 'Creating...' : 'Create share link'}
                  </Button>
                </div>
              </>
            )}
          </div>
        }
      >
        {/* Active shares list */}
        {activeShares.length > 0 && !showCreateForm && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-700">Active shares</h3>
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
                        <span className="text-sm font-medium text-neutral-900">
                          {expired ? 'Expired' : maxedOut ? 'Access limit reached' : 'Public link'}
                        </span>
                        {share.hasPassword && (
                          <Lock
                            className="w-3.5 h-3.5 text-neutral-500"
                            aria-label="Password protected"
                          />
                        )}
                        {share.showExternalLinks && (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
                            <GitBranch className="w-3.5 h-3.5" aria-hidden />
                            GitHub links shown
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                        <LinkIcon className="w-3 h-3" />
                        <span className="truncate max-w-[250px]">{getShareUrl(share.token)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
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
                  <div className="mt-3 pt-3 border-t border-neutral-200 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyLink(share.token, share.id)}
                      disabled={expired || maxedOut}
                      className={clsx(copiedId === share.id && 'bg-green-100 text-green-700')}
                      leadingIcon={copiedId === share.id ? <Check /> : <Copy />}
                    >
                      {copiedId === share.id ? 'Copied' : 'Copy link'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDisable(share.id)}
                      disabled={isDisabling}
                      className="text-amber-600 hover:bg-amber-50"
                      leadingIcon={<EyeOff />}
                    >
                      Disable
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(share.id)}
                      disabled={isDeleting}
                      className="text-red-600 hover:bg-red-50"
                      leadingIcon={<Trash2 />}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Inactive shares */}
        {inactiveShares.length > 0 && !showCreateForm && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-500">Disabled shares</h3>
            {inactiveShares.map((share) => (
              <Panel key={share.id} tone="muted" padding="sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-neutral-400" />
                      <span className="text-sm font-medium text-neutral-500">Disabled</span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      {share.accessCount} view{share.accessCount !== 1 ? 's' : ''} • Created{' '}
                      {new Date(share.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <IconButton
                    label="Delete share link"
                    variant="danger"
                    icon={<Trash2 />}
                    onClick={() => setConfirmDeleteId(share.id)}
                    disabled={isDeleting}
                  />
                </div>
              </Panel>
            ))}
          </div>
        )}

        {/* Create form */}
        {showCreateForm && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">
              Create a public link to share this view with anyone, even without a TasksFlow account.
            </p>

            <Field
              id="share-password"
              label={
                <>
                  <Lock className="w-4 h-4 inline mr-1" aria-hidden />
                  Password (optional)
                </>
              }
            >
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  placeholder="Leave empty for no password"
                />
                <IconButton
                  label={showPassword ? 'Hide password' : 'Show password'}
                  size="xs"
                  icon={showPassword ? <EyeOff /> : <Eye />}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                />
              </div>
            </Field>

            <Field
              id="share-expires"
              label={
                <>
                  <Calendar className="w-4 h-4 inline mr-1" aria-hidden />
                  Expiration date (optional)
                </>
              }
            >
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </Field>

            <Field
              id="share-max"
              label={
                <>
                  <Hash className="w-4 h-4 inline mr-1" aria-hidden />
                  Maximum access count (optional)
                </>
              }
            >
              <Input
                type="number"
                value={maxAccessCount}
                onChange={(e) => setMaxAccessCount(e.target.value)}
                min="1"
                placeholder="Leave empty for unlimited"
              />
            </Field>

            <Panel padding="sm">
              <Checkbox
                checked={showExternalLinks}
                onChange={(e) => setShowExternalLinks(e.target.checked)}
                label={<span className="font-medium">Show GitHub links</span>}
                description="Expose linked GitHub issue and pull request URLs on the public page."
              />
            </Panel>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        variant="danger"
        title="Delete share link?"
        description="Anyone using this link will no longer be able to access the view."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDeleteId) onDelete(confirmDeleteId);
        }}
      />
    </>
  );
}
