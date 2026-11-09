import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from './stores/auth';
import { Layout } from './components/layout/Layout';
import { PageSpinner } from './components/ui/Spinner';
import { RouteErrorBoundary } from './components/ui/ErrorBoundary';

/** React.lazy for a named export: one chunk per route. */
function lazyNamed<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const LoginPage = lazyNamed(() => import('./routes/auth/login'), 'LoginPage');
const RegisterPage = lazyNamed(() => import('./routes/auth/register'), 'RegisterPage');
const DashboardPage = lazyNamed(() => import('./routes/dashboard'), 'DashboardPage');
const ProjectPage = lazyNamed(() => import('./routes/project'), 'ProjectPage');
const NewProjectPage = lazyNamed(() => import('./routes/new-project'), 'NewProjectPage');
const ProjectsPage = lazyNamed(() => import('./routes/projects'), 'ProjectsPage');
const TaskPage = lazyNamed(() => import('./routes/task'), 'TaskPage');
const SmartViewPage = lazyNamed(() => import('./routes/smart-view'), 'SmartViewPage');
const ViewsPage = lazyNamed(() => import('./routes/views'), 'ViewsPage');
const SettingsPage = lazyNamed(() => import('./routes/settings'), 'SettingsPage');
const PublicSharePage = lazyNamed(() => import('./routes/share'), 'PublicSharePage');
const ProjectSettingsPage = lazyNamed(() => import('./routes/project-settings'), 'ProjectSettingsPage');
const GitHubCallbackPage = lazyNamed(() => import('./routes/github-callback'), 'GitHubCallbackPage');
const InvitePage = lazyNamed(() => import('./routes/invite'), 'InvitePage');
const InboxPage = lazyNamed(() => import('./routes/inbox'), 'InboxPage');
const MyTasksPage = lazyNamed(() => import('./routes/my-tasks'), 'MyTasksPage');
const TrashPage = lazyNamed(() => import('./routes/trash'), 'TrashPage');

/** Route element wrapper: per-route error boundary + Suspense for the lazy chunk. */
function Page({ children }: { children: ReactNode }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageSpinner />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, hasCheckedAuth } = useAuthStore(
    useShallow((s) => ({ isAuthenticated: s.isAuthenticated, isLoading: s.isLoading, hasCheckedAuth: s.hasCheckedAuth }))
  );

  if (isLoading || !hasCheckedAuth) {
    return <PageSpinner className="h-screen" label="Checking your session" />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Auth routes */}
      <Route path="/login" element={<Page><LoginPage /></Page>} />
      <Route path="/register" element={<Page><RegisterPage /></Page>} />

      {/* Public share route */}
      <Route path="/share/:token" element={<Page><PublicSharePage /></Page>} />

      {/* Invitation page - shows invite details and allows accepting */}
      <Route path="/invite/:token" element={<Page><InvitePage /></Page>} />

      {/* GitHub callback - outside protected routes to avoid auth interference */}
      <Route path="/github/callback" element={<Page><GitHubCallbackPage /></Page>} />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Page><DashboardPage /></Page>} />
                <Route path="/projects" element={<Page><ProjectsPage /></Page>} />
                <Route path="/projects/new" element={<Page><NewProjectPage /></Page>} />
                <Route path="/project/:projectId" element={<Page><ProjectPage /></Page>} />
                <Route path="/project/:projectId/settings" element={<Page><ProjectSettingsPage /></Page>} />
                <Route path="/project/:projectId/trash" element={<Page><TrashPage /></Page>} />
                <Route path="/inbox" element={<Page><InboxPage /></Page>} />
                <Route path="/my-tasks" element={<Page><MyTasksPage /></Page>} />
                <Route path="/task/:taskId" element={<Page><TaskPage /></Page>} />
                <Route path="/views" element={<Page><ViewsPage /></Page>} />
                <Route path="/view/:viewId" element={<Page><SmartViewPage /></Page>} />
                <Route path="/settings/*" element={<Page><SettingsPage /></Page>} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
