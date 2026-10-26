/** Small fetch wrapper for the app's own JSON API. Throws Error with a readable message. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    throw new Error(msg ?? (res.status === 401 ? "You need to sign in." : `Request failed (${res.status}).`));
  }
  return data as T;
}
