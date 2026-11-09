import type { PublicShare, SmartView, SmartViewShare } from '../../db/index.js';

/**
 * Who may do what with a smart view, given the caller's workspace role.
 *
 * - Team views (`isPersonal = false`) are readable by every workspace member.
 * - Personal views are readable only by their creator, plus users the creator
 *   explicitly shared them with.
 * - The creator can always edit/delete their own view. Other users need the
 *   role permission (team views only) or an explicit `edit` share.
 * - Sharing (user shares and public links) needs `smart_view:share`, and a
 *   personal view can only be shared by its creator.
 */
export type SmartViewAction = 'read' | 'update' | 'delete' | 'share';

export interface SmartViewRolePermissions {
  update: boolean;
  delete: boolean;
  share: boolean;
}

type ViewForAccess = Pick<SmartView, 'createdBy' | 'isPersonal'> & {
  shares: Pick<SmartViewShare, 'sharedWithUserId' | 'permission'>[];
};

export function canAccessSmartView(
  view: ViewForAccess,
  userId: string,
  rolePermissions: SmartViewRolePermissions,
  action: SmartViewAction
): boolean {
  const isCreator = view.createdBy !== null && view.createdBy === userId;
  const share = view.shares.find((s) => s.sharedWithUserId === userId);
  const canRead = !view.isPersonal || isCreator || Boolean(share);

  if (!canRead) return false;

  switch (action) {
    case 'read':
      return true;
    case 'update':
      return (
        isCreator || share?.permission === 'edit' || (!view.isPersonal && rolePermissions.update)
      );
    case 'delete':
      return isCreator || (!view.isPersonal && rolePermissions.delete);
    case 'share':
      return rolePermissions.share && (!view.isPersonal || isCreator);
  }
}

/** Public-share fields safe to return to workspace members who manage shares. */
export type PublicShareSummary = Omit<PublicShare, 'passwordHash'> & { hasPassword: boolean };

export function toPublicShareSummary(share: PublicShare): PublicShareSummary {
  const { passwordHash, ...rest } = share;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

/**
 * Strip secrets from a smart view before returning it. Public share tokens
 * are only included for callers allowed to manage sharing.
 */
export function toSmartViewDto<V extends { publicShares: PublicShare[] }>(
  view: V,
  options: { includePublicShares: boolean }
): Omit<V, 'publicShares'> & { publicShares: PublicShareSummary[] } {
  return {
    ...view,
    publicShares: options.includePublicShares ? view.publicShares.map(toPublicShareSummary) : [],
  };
}
