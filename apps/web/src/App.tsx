import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './routes/auth/login';
import { RegisterPage } from './routes/auth/register';
import { DashboardPage } from './routes/dashboard';
import { ProjectPage } from './routes/project';
import { NewProjectPage } from './routes/new-project';
import { ProjectsPage } from './routes/projects';
import { TaskPage } from './routes/task';
import { SmartViewPage } from './routes/smart-view';
import { ViewsPage } from './routes/views';
import { SettingsPage } from './routes/settings';
import { PublicSharePage } from './routes/share';
import { ProjectSettingsPage } from './routes/project-settings';
import { GitHubCallbackPage } from './routes/github-callback';
import { InvitePage } from './routes/invite';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Public share route */}
      <Route path="/share/:token" element={<PublicSharePage />} />

      {/* Invitation page - shows invite details and allows accepting */}
      <Route path="/invite/:token" element={<InvitePage />} />

      {/* GitHub callback - outside protected routes to avoid auth interference */}
      <Route path="/github/callback" element={<GitHubCallbackPage />} />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<NewProjectPage />} />
                <Route path="/project/:projectId" element={<ProjectPage />} />
                <Route path="/project/:projectId/settings" element={<ProjectSettingsPage />} />
                <Route path="/task/:taskId" element={<TaskPage />} />
                <Route path="/views" element={<ViewsPage />} />
                <Route path="/view/:viewId" element={<SmartViewPage />} />
                <Route path="/settings/*" element={<SettingsPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
