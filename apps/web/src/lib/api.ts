"use client";
import useSWR, { type SWRConfiguration } from "swr";

/** All browser calls go through the BFF proxy; tokens stay server-side. */
const base = (path: string) => `/api/proxy/${path.replace(/^\//, "")}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    throw new ApiError(res.status, msg ?? `Request failed (${res.status})`);
  }
  return data;
}

export const apiGet = <T = unknown>(path: string): Promise<T> =>
  fetch(base(path), { credentials: "same-origin" }).then(parse);

export const apiSend = <T = unknown>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> =>
  fetch(base(path), {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(parse);

/** SWR read hook with loading/error/empty baked in. `path=null` skips the fetch. */
export function useApi<T = unknown>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T>(path, apiGet, { revalidateOnFocus: false, ...config });
}

export async function login(email: string, password: string, totp?: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, totp }),
  });
  return parse(res);
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

/** Request a password-reset link. Always resolves (generic, non-enumerating). */
export async function requestReset(email: string) {
  const res = await fetch("/api/auth/request-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return parse(res);
}

/** Set a new password using an emailed token. */
export async function resetPassword(token: string, newPassword: string) {
  const res = await fetch("/api/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  return parse(res);
}
