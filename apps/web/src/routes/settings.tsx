import { useMemo } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  User,
  Building2,
  Link2,
  Bot,
  Eye,
  Users,
  Shield,
  Plug,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { AgentSettings } from '../components/settings/AgentSettings';
import { AiSettings } from '../components/settings/AiSettings';
import { AppOverviewSettings } from '../components/settings/AppOverviewSettings';
import { AppScopeForbidden } from '../components/settings/AppScopeForbidden';
import { AppUserManagementSettings } from '../components/settings/AppUserManagementSettings';
import { IntegrationSettings } from '../components/settings/IntegrationSettings';
import { MemberSettings } from '../components/settings/MemberSettings';
import { NewWorkspaceSettings } from '../components/settings/NewWorkspaceSettings';
import { ProfileSettings } from '../components/settings/ProfileSettings';
import { ViewsSettings } from '../components/settings/ViewsSettings';
import { WebhookSettings } from '../components/settings/WebhookSettings';
import { WorkspaceGeneralSettings } from '../components/settings/WorkspaceGeneralSettings';
import { SmartViewForm } from '../components/smart-views/SmartViewForm';
import { Banner } from '../components/ui';
import { useAppContext, useCurrentWorkspace, useWorkspaceRole } from '../hooks/queries';

type NavigationItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

type NavigationSection = {
  title: string;
  description: string;
  items: NavigationItem[];
};

/** Settings shell: scoped navigation (user / workspace / app) and the nested tab routes. */
export function SettingsPage() {
  const location = useLocation();
  const { workspace, isLoading: isLoadingWorkspace } = useCurrentWorkspace();
  const appContext = useAppContext();
  const workspaceRole = useWorkspaceRole(workspace?.id);

  const appRole = appContext.data?.appRole ?? null;
  const isAppManager = appRole === 'app_manager';
  const canManageWorkspace = workspaceRole.data === 'owner' || workspaceRole.data === 'admin';
  // The role query is disabled (not "loading") until the workspace list arrives.
  const isRolePending = isLoadingWorkspace || (Boolean(workspace) && workspaceRole.isPending);
  const isLoadingPermissions = appContext.isLoading || isRolePending;

  const navigationSections = useMemo<NavigationSection[]>(() => {
    const workspaceItems: NavigationItem[] = [
      { name: 'Workspace', href: '/settings/workspace/general', icon: Building2 },
      { name: 'Members', href: '/settings/workspace/members', icon: Users },
      { name: 'Views', href: '/settings/workspace/views', icon: Eye },
    ];
    if (canManageWorkspace) {
      workspaceItems.push(
        { name: 'AI & Agents', href: '/settings/workspace/api-keys', icon: Bot },
        { name: 'MCP Connections', href: '/settings/workspace/mcp-connections', icon: Plug },
        { name: 'Outgoing Webhooks', href: '/settings/workspace/webhooks', icon: Webhook }
      );
    }

    const sections: NavigationSection[] = [
      {
        title: 'User Settings',
        description: 'Personal settings for your account.',
        items: [
          { name: 'Profile', href: '/settings/user/profile', icon: User },
          { name: 'Integrations', href: '/settings/user/integrations', icon: Link2 },
        ],
      },
      {
        title: 'Workspace Settings',
        description: 'Settings for the selected workspace.',
        items: workspaceItems,
      },
    ];
    if (isAppManager) {
      sections.push({
        title: 'App Settings',
        description: 'Global settings for the whole application.',
        items: [
          { name: 'Overview', href: '/settings/app/overview', icon: Shield },
          { name: 'User Management', href: '/settings/app/users', icon: Users },
        ],
      });
    }
    return sections;
  }, [canManageWorkspace, isAppManager]);

  /** Admin-only tabs: wait for the role instead of redirecting while it loads. */
  const adminOnly = (element: JSX.Element) =>
    canManageWorkspace || isRolePending ? (
      element
    ) : (
      <Navigate to="/settings/workspace/general" replace />
    );

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-sm text-gray-600">
          Settings are separated by scope: user, workspace, and app.
        </p>
      </header>

      {appContext.error && (
        <Banner variant="warning" className="mb-4">
          Could not load your app permissions: {appContext.error.message}
        </Banner>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        <nav
          aria-label="Settings"
          className="w-full md:w-64 space-y-4"
          aria-busy={isLoadingPermissions}
        >
          {navigationSections.map((section) => (
            <section
              key={section.title}
              aria-labelledby={`settings-${section.title}`}
              className="border border-gray-200 rounded-lg p-3"
            >
              <h2 id={`settings-${section.title}`} className="text-sm font-semibold text-gray-900">
                {section.title}
              </h2>
              <p className="text-xs text-gray-500 mt-1 mb-2">{section.description}</p>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.href ||
                    location.pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.name}>
                      <Link
                        to={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={clsx(
                          'flex items-center px-3 py-2 text-sm font-medium rounded-lg',
                          isActive
                            ? 'bg-primary-50 text-primary-700'
                            : 'text-gray-700 hover:bg-gray-100'
                        )}
                      >
                        <Icon aria-hidden className="w-5 h-5 mr-3" />
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <Routes>
            <Route index element={<Navigate to="user/profile" replace />} />

            <Route path="user/profile" element={<ProfileSettings />} />
            <Route path="user/integrations" element={<IntegrationSettings />} />
            <Route
              path="user/api-keys"
              element={<Navigate to="/settings/workspace/api-keys" replace />}
            />

            <Route path="workspace/general" element={<WorkspaceGeneralSettings />} />
            <Route path="workspace/new" element={<NewWorkspaceSettings />} />
            <Route path="workspace/members" element={<MemberSettings />} />
            <Route path="workspace/views" element={<ViewsSettings />} />
            <Route path="workspace/views/new" element={<SmartViewForm />} />
            <Route path="workspace/views/:viewId/edit" element={<SmartViewForm />} />
            <Route path="workspace/api-keys" element={adminOnly(<AiSettings />)} />
            <Route path="workspace/mcp-connections" element={adminOnly(<AgentSettings />)} />
            <Route path="workspace/webhooks" element={adminOnly(<WebhookSettings />)} />
            <Route
              path="workspace/agents"
              element={<Navigate to="/settings/workspace/mcp-connections" replace />}
            />

            <Route
              path="app/overview"
              element={
                isAppManager ? <AppOverviewSettings appRole={appRole} /> : <AppScopeForbidden />
              }
            />
            <Route
              path="app/users"
              element={
                isAppManager ? (
                  <AppUserManagementSettings isAppManager={isAppManager} />
                ) : (
                  <AppScopeForbidden />
                )
              }
            />

            {/* Legacy compatibility paths */}
            <Route path="profile" element={<Navigate to="/settings/user/profile" replace />} />
            <Route
              path="integrations"
              element={<Navigate to="/settings/user/integrations" replace />}
            />
            <Route
              path="api-keys"
              element={<Navigate to="/settings/workspace/api-keys" replace />}
            />
            <Route
              path="workspace"
              element={<Navigate to="/settings/workspace/general" replace />}
            />
            <Route
              path="workspaces/new"
              element={<Navigate to="/settings/workspace/new" replace />}
            />
            <Route path="members" element={<Navigate to="/settings/workspace/members" replace />} />
            <Route path="views" element={<Navigate to="/settings/workspace/views" replace />} />
            <Route
              path="views/new"
              element={<Navigate to="/settings/workspace/views/new" replace />}
            />
            <Route path="views/:viewId/edit" element={<SmartViewForm />} />
            <Route
              path="agents"
              element={<Navigate to="/settings/workspace/mcp-connections" replace />}
            />
            <Route
              path="webhooks"
              element={<Navigate to="/settings/workspace/webhooks" replace />}
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}
