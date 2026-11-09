import { useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Settings2,
  Layers,
  Tag,
  AlertTriangle,
  ShieldX,
  Lock,
  MessageSquare,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject, useProjectPermissions } from '../hooks/queries';
import { ErrorState, PageSpinner } from '../components/ui';
import { GeneralSettings } from '../components/project-settings/GeneralSettings';
import { TaskStatesSettings } from '../components/project-settings/TaskStatesSettings';
import { LabelsSettings } from '../components/project-settings/LabelsSettings';
import { AccessSettings } from '../components/project-settings/AccessSettings';
import { GitHubSettings } from '../components/project-settings/GitHubSettings';
import { SlackSettings } from '../components/project-settings/SlackSettings';
import { DangerZone } from '../components/project-settings/DangerZone';

// GitHub icon component
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

type SettingsSection = 'general' | 'states' | 'labels' | 'access' | 'github' | 'slack' | 'danger';

const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'states',
  'labels',
  'access',
  'github',
  'slack',
  'danger',
];

function isSettingsSection(value: string | null): value is SettingsSection {
  return value !== null && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  // ?section= deep-links a tab (the GitHub/Slack install callbacks land on theirs).
  const [searchParams] = useSearchParams();
  // Error redirects from the install callbacks may omit ?section=.
  const requestedSection =
    searchParams.get('section') ??
    (searchParams.has('slack_error')
      ? 'slack'
      : searchParams.has('github_error')
        ? 'github'
        : null);
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    isSettingsSection(requestedSection) ? requestedSection : 'general'
  );

  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    refetch: refetchProject,
  } = useProject(projectId);
  const { data: permissions, isLoading: permissionsLoading } = useProjectPermissions(projectId);

  const navigation = [
    { id: 'general' as const, name: 'General', icon: Settings2 },
    { id: 'states' as const, name: 'Task States', icon: Layers },
    { id: 'labels' as const, name: 'Labels', icon: Tag },
    { id: 'access' as const, name: 'Access', icon: Lock },
    { id: 'github' as const, name: 'GitHub', icon: GithubIcon },
    { id: 'slack' as const, name: 'Slack', icon: MessageSquare },
    { id: 'danger' as const, name: 'Danger Zone', icon: AlertTriangle },
  ];

  if (projectLoading || permissionsLoading) {
    return <PageSpinner label="Loading project settings" />;
  }

  if (!project) {
    return (
      <ErrorState
        error={projectError}
        resource="project"
        onRetry={() => void refetchProject()}
        notFoundAction={
          <Link to="/projects" className="btn btn-secondary">
            Back to projects
          </Link>
        }
      />
    );
  }

  if (!permissions?.canEdit) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldX aria-hidden className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-neutral-900 mb-2">Access Denied</h2>
        <p className="text-neutral-600 mb-6">
          You don't have permission to access the settings for this project. Contact a workspace
          admin if you need access.
        </p>
        <Link to={`/project/${projectId}`} className="btn btn-primary inline-flex items-center">
          <ArrowLeft aria-hidden className="w-4 h-4 mr-2" />
          Back to Project
        </Link>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings project={project} />;
      case 'states':
        return <TaskStatesSettings projectId={project.id} states={project.taskStates} />;
      case 'labels':
        return <LabelsSettings projectId={project.id} labels={project.labels} />;
      case 'access':
        return (
          <AccessSettings
            projectId={project.id}
            workspaceId={project.workspaceId}
            currentAccess={project.access || 'all'}
          />
        );
      case 'github':
        return <GitHubSettings projectId={project.id} />;
      case 'slack':
        return <SlackSettings projectId={project.id} />;
      case 'danger':
        return permissions?.canDelete ? (
          <DangerZone project={project} onDeleted={() => navigate('/projects')} />
        ) : (
          <div className="card p-6">
            <p className="text-neutral-600">You don't have permission to delete this project.</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <Link
          to={`/project/${projectId}`}
          className="inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900 mb-2"
        >
          <ArrowLeft aria-hidden className="w-4 h-4 mr-1" />
          Back to project
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900">{project.name} Settings</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Manage your project settings, task states, and labels
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Navigation */}
        <nav aria-label="Project settings" className="w-full md:w-48 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const isDanger = item.id === 'danger';
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveSection(item.id)}
                className={clsx(
                  'flex items-center w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                  isActive
                    ? isDanger
                      ? 'bg-red-50 text-red-600'
                      : 'bg-primary-50 text-primary-600'
                    : isDanger
                      ? 'text-neutral-700 hover:bg-red-50 hover:text-red-600'
                      : 'text-neutral-700 hover:bg-neutral-100'
                )}
              >
                <Icon
                  aria-hidden
                  className={clsx('w-5 h-5 mr-3', isDanger && !isActive && 'text-neutral-400')}
                />
                {item.name}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1">{renderContent()}</div>
      </div>
    </div>
  );
}
