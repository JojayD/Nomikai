import { createClient } from "./supabase/client";

const BASE = process.env.NEXT_PUBLIC_API_URL!;

// The API answers with { code, message } for Postgres constraint violations,
// so callers can keep switching on the SQLSTATE (23505 = already taken).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  token: string | null,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      // FormData sets its own multipart boundary
      ...(init?.body && !(init.body instanceof FormData) && {
        "content-type": "application/json",
      }),
      ...init?.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status === 429
        ? "Slow down a moment, then try again."
        : (body?.message ?? `Request failed (${res.status})`),
      res.status,
      body?.code
    );
  }
  return body as T;
}

/** Client-component calls; the access token comes from the browser session. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await createClient().auth.getSession();
  return apiFetch<T>(data.session?.access_token ?? null, path, init);
}

export function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}
