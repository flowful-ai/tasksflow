/**
 * Typed TanStack Query hooks: the only way components read server state.
 * Keys come from src/api/queryKeys.ts; fetchers from src/api/*.
 */
export * from './workspaces';
export * from './projects';
export * from './tasks';
export * from './taskExtras';
export * from './notifications';
export * from './smartViews';
export * from './integrations';
export * from './settings';
export {
  flattenPages,
  moveTaskInList,
  taskListAdapter,
  smartViewAdapter,
  type TaskPages,
  type SmartViewPages,
} from './taskCache';
