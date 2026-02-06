import { useMemo } from 'react';
import { Plus, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FilterGroup, FilterCondition } from '@flowtask/shared';
import { api } from '../../../api/client';
import { FilterConditionRow } from './FilterConditionRow';
import { FILTER_FIELDS, OPERATORS_BY_TYPE } from './constants';

interface WorkspaceDetail {
  id: string;
  name: string;
  members: {
    userId: string;
    role: string;
    user: {
      id: string;
      name: string | null;
      email: string;
    };
  }[];
}

// Extended project type that includes relations (the API actually returns this)
interface ProjectWithRelations {
  id: string;
  name: string;
  taskStates?: { id: string; name: string; category: string; color: string | null }[];
  labels?: { id: string; name: string; color: string | null }[];
}

interface FilterBuilderProps {
  value: FilterGroup;
  onChange: (filters: FilterGroup) => void;
  workspaceId: string;
}

export function FilterBuilder({ value, onChange, workspaceId }: FilterBuilderProps) {
  // Fetch workspace members
  const { data: workspaceDetail } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const response = await api.get<{ data: WorkspaceDetail }>(`/api/workspaces/${workspaceId}`);
      return response.data;
    },
    enabled: !!workspaceId,
  });

  // Fetch projects with their states and labels
  const { data: projectsData } = useQuery({
    queryKey: ['projects-with-relations', workspaceId],
    queryFn: async () => {
      const response = await api.get<{ data: ProjectWithRelations[] }>(
        `/api/projects?workspaceId=${workspaceId}`
      );
      return response.data || [];
    },
    enabled: !!workspaceId,
  });

  // Aggregate labels and state categories from all projects
  const { labels, stateCategories, projects } = useMemo(() => {
    const labelsMap = new Map<string, { id: string; name: string; color: string | null }>();
    const categoriesSet = new Set<string>();
    const projects: { id: string; name: string }[] = [];

    for (const project of projectsData || []) {
      projects.push({ id: project.id, name: project.name });
      // Aggregate labels
      for (const label of project.labels || []) {
        labelsMap.set(label.id, label);
      }
      // Aggregate unique state categories
      for (const state of project.taskStates || []) {
        categoriesSet.add(state.category);
      }
    }

    // Convert categories to options with readable labels
    const stateCategories = Array.from(categoriesSet).map((cat) => ({
      value: cat,
      label: cat
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    }));

    return {
      labels: Array.from(labelsMap.values()),
      stateCategories,
      projects,
    };
  }, [projectsData]);

  const workspaceMembers = workspaceDetail?.members || [];

  // Only work with simple conditions (not nested groups for now)
  const conditions = value.conditions.filter(
    (c): c is FilterCondition => 'field' in c
  );

  const handleOperatorToggle = () => {
    onChange({
      ...value,
      operator: value.operator === 'AND' ? 'OR' : 'AND',
    });
  };

  const handleAddCondition = () => {
    const defaultField = Object.keys(FILTER_FIELDS)[0];
    const defaultFieldType = FILTER_FIELDS[defaultField].type;
    const defaultOp = OPERATORS_BY_TYPE[defaultFieldType][0];

    const newCondition: FilterCondition = {
      field: defaultField,
      op: defaultOp,
      value: undefined,
    };

    onChange({
      ...value,
      conditions: [...value.conditions, newCondition],
    });
  };

  const handleConditionChange = (index: number, newCondition: FilterCondition) => {
    const newConditions = [...value.conditions];
    newConditions[index] = newCondition;
    onChange({
      ...value,
      conditions: newConditions,
    });
  };

  const handleConditionRemove = (index: number) => {
    const newConditions = value.conditions.filter((_, i) => i !== index);
    onChange({
      ...value,
      conditions: newConditions,
    });
  };

  return (
    <div className="border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Filter className="w-4 h-4" />
          <span>Match</span>
          <button
            type="button"
            onClick={handleOperatorToggle}
            className="px-2 py-0.5 font-medium text-primary-700 bg-primary-100 rounded hover:bg-primary-200 transition-colors"
          >
            {value.operator === 'AND' ? 'all' : 'any'}
          </button>
          <span>of the following conditions:</span>
        </div>
      </div>

      {/* Conditions */}
      <div className="p-4 space-y-2">
        {conditions.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-500 mb-3">
              No filters. All tasks will be included.
            </p>
            <button
              type="button"
              onClick={handleAddCondition}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add filter
            </button>
          </div>
        ) : (
          <>
            {conditions.map((condition, index) => (
              <FilterConditionRow
                key={index}
                condition={condition}
                onChange={(newCondition) => handleConditionChange(index, newCondition)}
                onRemove={() => handleConditionRemove(index)}
                workspaceMembers={workspaceMembers}
                labels={labels}
                stateCategories={stateCategories}
                projects={projects}
              />
            ))}

            {/* Add button */}
            <button
              type="button"
              onClick={handleAddCondition}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add filter
            </button>
          </>
        )}
      </div>
    </div>
  );
}
