const ACCESS_TOKEN_KEY = "awm_access_token";
export const UNAUTHORIZED_EVENT = "awm:unauthorized";

export function getAccessToken(): string | null {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  try {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode) — the session just re-prompts next load.
  }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token === null ? {} : { "x-access-token": token };
}

function handleUnauthorized(res: Response): void {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(`GET ${path} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    const detail = (await res.json().catch(() => null)) as {
      message?: string | { message?: string; issues?: string[] };
    } | null;
    const message =
      typeof detail?.message === "string"
        ? detail.message
        : (detail?.message?.issues?.join("; ") ?? detail?.message?.message);
    throw new Error(message ?? `${method} ${path} failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
