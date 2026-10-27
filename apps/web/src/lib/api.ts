const TOKEN_KEY = 'bidlock.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only login */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, body.error ?? String(res.status), body.message ?? res.statusText, body);
  }
  return body as T;
}

/**
 * Places a bid with an idempotency key. A network failure is retried with the SAME key,
 * so the server applies it at most once even if the first response was lost.
 */
export async function placeBid(auctionId: number, amount: number) {
  const key = crypto.randomUUID();
  const send = () =>
    api(`/auctions/${auctionId}/bids`, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({ amount }),
    });
  try {
    return await send();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    await new Promise((r) => setTimeout(r, 300));
    return send();
  }
}
