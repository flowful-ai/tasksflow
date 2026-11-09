import { useMatch } from 'react-router-dom';
import { useWorkspaceStore } from '../../stores/workspace';

/** Project of the current route (/project/:id[/…]), else null. */
export function useRouteProjectId(): string | null {
  const match = useMatch('/project/:projectId/*');
  return match?.params.projectId ?? null;
}

/** Project for "create task": the route's, else the last visited one. */
export function useDefaultProjectId(): string | null {
  const routeProjectId = useRouteProjectId();
  const lastProjectId = useWorkspaceStore((s) => s.currentProjectId);
  return routeProjectId ?? lastProjectId;
}
