import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Settings2, Layers, Tag, AlertTriangle, ShieldX } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { GeneralSettings } from '../components/project-settings/GeneralSettings';
import { TaskStatesSettings } from '../components/project-settings/TaskStatesSettings';
import { LabelsSettings } from '../components/project-settings/LabelsSettings';
import { GitHubSettings } from '../components/project-settings/GitHubSettings';
import { DangerZone } from '../components/project-settings/DangerZone';

// GitHub icon component
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

type SettingsSection = 'general' | 'states' | 'labels' | 'github' | 'danger';

interface ProjectData {
  id: string;
  workspaceId: string;
  name: string;
  identifier: string;
  description: string | null;
  icon: string | null;
  isArchived: boolean;
  taskStates: Array<{
    id: string;
    name: string;
    category: 'backlog' | 'in_progress' | 'done';
    color: string | null;
    position: string;
  }>;
  labels: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
}

interface PermissionsData {
  role: string;
  canEdit: boolean;
  canDelete: boolean;
}

export function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  const { data: project, isLoading: projectLoading, refetch: refetchProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: ProjectData }>(`/api/projects/${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

  const { data: permissions, isLoading: permissionsLoading } = useQuery({
    queryKey: ['project-permissions', projectId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: PermissionsData }>(`/api/projects/${projectId}/permissions`);
      return response.data;
    },
    enabled: !!projectId,
  });

  const navigation = [
    { id: 'general' as const, name: 'General', icon: Settings2 },
    { id: 'states' as const, name: 'Task States', icon: Layers },
    { id: 'labels' as const, name: 'Labels', icon: Tag },
    { id: 'github' as const, name: 'GitHub', icon: GithubIcon },
    { id: 'danger' as const, name: 'Danger Zone', icon: AlertTriangle },
  ];

  if (projectLoading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Project not found</h2>
        <Link to="/projects" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to projects
        </Link>
      </div>
    );
  }

  if (!permissions?.canEdit) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldX className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600 mb-6">
          You don't have permission to access the settings for this project.
          Contact a workspace admin if you need access.
        </p>
        <Link
          to={`/project/${projectId}`}
          className="btn btn-primary inline-flex items-center"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Project
        </Link>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <GeneralSettings
            project={project}
            onUpdated={refetchProject}
          />
        );
      case 'states':
        return (
          <TaskStatesSettings
            projectId={project.id}
            states={project.taskStates}
            onUpdated={refetchProject}
          />
        );
      case 'labels':
        return (
          <LabelsSettings
            projectId={project.id}
            labels={project.labels}
            onUpdated={refetchProject}
          />
        );
      case 'github':
        return (
          <GitHubSettings
            projectId={project.id}
            onUpdated={refetchProject}
          />
        );
      case 'danger':
        return permissions?.canDelete ? (
          <DangerZone
            project={project}
            onDeleted={() => navigate('/projects')}
          />
        ) : (
          <div className="card p-6">
            <p className="text-gray-600">
              You don't have permission to delete this project.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          to={`/project/${projectId}`}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-2"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to project
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {project.name} Settings
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage your project settings, task states, and labels
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Navigation */}
        <nav className="w-full md:w-48 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const isDanger = item.id === 'danger';
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={clsx(
                  'flex items-center w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                  isActive
                    ? isDanger
                      ? 'bg-red-50 text-red-600'
                      : 'bg-primary-50 text-primary-600'
                    : isDanger
                    ? 'text-gray-700 hover:bg-red-50 hover:text-red-600'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
              >
                <Icon className={clsx('w-5 h-5 mr-3', isDanger && !isActive && 'text-gray-400')} />
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
