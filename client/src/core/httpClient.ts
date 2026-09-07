// Shared typed HTTP client. Domain modules (e.g. gear/api.ts) build a typed API layer
// over this rather than calling fetch directly. core/api.js is the existing untyped
// client used by the rest of the app; the two coexist until the rest of the client
// converts (convergence task 7 / §6.1).
const BASE = '/api';

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: string; status?: number };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(result: ApiResult<T>): result is ApiFailure {
  return result.ok === false;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': newRequestId(),
        ...(options.headers as Record<string, string> | undefined),
      },
      credentials: 'include',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || `Request failed: ${res.status}`, status: res.status };
    }

    if (res.status === 204) {
      return { ok: true, data: null as T };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
