/**
 * Low-level HTTP client shared by every resource module in src/api/.
 *
 * - Sends cookies (`credentials: 'include'`) and the browser's IANA timezone
 *   as `X-Timezone` on every request.
 * - Normalises the API error formats (`{ success:false, error:{code,message} }`,
 *   Better Auth's `{ code, message }`, `{ error: "..." }`) into `ApiError`.
 * - Network failures become `ApiError` with `status: 0` / `code: 'NETWORK_ERROR'`.
 * - A 401 from any non-auth endpoint calls the handler registered with
 *   `setUnauthorizedHandler` (src/lib/queryClient.ts clears the cache and the session).
 */
import { isJsonObject, type JsonValue } from '@flowtask/shared/json';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL || '';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** Serialised as JSON. */
  body?: object;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** `{ success: true, data, meta? }`: the envelope every FlowTask route returns. */
export interface ApiEnvelope<T, M = undefined> {
  success: boolean;
  data: T;
  meta?: M;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
}

export interface CursorMeta {
  nextCursor: string | null;
}

export class ApiError extends Error {
  readonly code: string;
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** No response (offline, DNS, CORS, aborted) or a 5xx: worth retrying. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function isApiError(error: Error | null | undefined): error is ApiError {
  return error instanceof ApiError;
}

let unauthorizedHandler: (() => void) | null = null;

/** Registered once at startup; called when a request returns 401. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** The browser's IANA timezone (e.g. "Europe/Paris"), or null when unavailable. */
export function getTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function errorFromBody(data: JsonValue | undefined, status: number): ApiError {
  let message = status >= 500 ? 'The server had a problem. Please try again.' : 'An error occurred';
  let code = 'UNKNOWN';

  if (data !== undefined && isJsonObject(data)) {
    const nested = data.error;
    if (typeof data.message === 'string') {
      // Better Auth: { code, message }
      message = data.message;
      if (typeof data.code === 'string') code = data.code;
    } else if (nested !== undefined && isJsonObject(nested)) {
      // FlowTask: { success: false, error: { code, message } }
      if (typeof nested.message === 'string') message = nested.message;
      if (typeof nested.code === 'string') code = nested.code;
    } else if (typeof nested === 'string') {
      message = nested;
    }
  }
  return new ApiError(message, code, status);
}

function isAuthEndpoint(endpoint: string): boolean {
  return endpoint.startsWith('/api/auth/') || endpoint.startsWith('/api/public/');
}

export async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = options;
  const timezone = getTimezone();

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(timezone ? { 'X-Timezone': timezone } : {}),
      ...headers,
    },
    credentials: 'include',
    signal,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Network error: check your connection and try again.', 'NETWORK_ERROR', 0);
  }

  // Tolerate empty bodies (204) and non-JSON responses.
  const text = await response.text();
  let data: JsonValue | undefined;
  if (text) {
    try {
      data = JSON.parse(text) as JsonValue;
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !isAuthEndpoint(endpoint)) unauthorizedHandler?.();
    throw errorFromBody(data, response.status);
  }

  // The API contract is not validated at runtime; callers type the payload.
  return data as T;
}

/** Raw envelope access (`{ success, data, meta }`). */
export const api = {
  get: <T>(endpoint: string, signal?: AbortSignal) => request<T>(endpoint, { signal }),
  post: <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: 'POST', body }),
  put: <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: 'PUT', body }),
  patch: <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: 'PATCH', body }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
};

/** Unwrapped access: resolves to the envelope's `data`. */
export const http = {
  get: async <T>(endpoint: string, signal?: AbortSignal): Promise<T> =>
    (await request<ApiEnvelope<T>>(endpoint, { signal })).data,
  post: async <T>(endpoint: string, body?: object): Promise<T> =>
    (await request<ApiEnvelope<T>>(endpoint, { method: 'POST', body })).data,
  put: async <T>(endpoint: string, body?: object): Promise<T> =>
    (await request<ApiEnvelope<T>>(endpoint, { method: 'PUT', body })).data,
  patch: async <T>(endpoint: string, body?: object): Promise<T> =>
    (await request<ApiEnvelope<T>>(endpoint, { method: 'PATCH', body })).data,
  delete: async <T = null>(endpoint: string): Promise<T> =>
    (await request<ApiEnvelope<T>>(endpoint, { method: 'DELETE' }))?.data,
};

/** Build a query string, skipping undefined/null/'' values. Returns '' or '?a=b'. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
