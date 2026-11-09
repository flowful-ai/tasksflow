/**
 * Barrel for the API layer. Prefer importing from the resource module
 * (./tasks, ./projects, ...) in new code; this file only re-exports them.
 *
 * Every resource function resolves to the envelope's `data` (see http.ts);
 * the few that need `meta` (paged lists) return the whole envelope.
 */
export { api, http, qs, request, ApiError, isApiError, getTimezone, setUnauthorizedHandler, API_BASE_URL } from './http';
export type { ApiEnvelope, PageMeta, CursorMeta, RequestOptions } from './http';
export * from './types';
export * from './workspaces';
export * from './projects';
export * from './tasks';
export * from './notifications';
export * from './smartViews';
export * from './agents';
export * from './integrations';
