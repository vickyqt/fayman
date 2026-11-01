"use client";
/** Typed fetch wrapper for the orchestrator's API routes. */
export async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error + (data.issues ? `: ${data.issues.join("; ")}` : ""));
  return data as T;
}
