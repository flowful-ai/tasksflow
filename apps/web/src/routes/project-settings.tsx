import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Settings2, Layers, Tag, AlertTriangle, ShieldX } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { GeneralSettings } from '../components/project-settings/GeneralSettings';
import { TaskStatesSettings } from '../components/project-settings/TaskStatesSettings';
import { LabelsSettings } from '../components/project-settings/LabelsSettings';
import { DangerZone } from '../components/project-settings/DangerZone';

type SettingsSection = 'general' | 'states' | 'labels' | 'danger';

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
    category: string;
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
