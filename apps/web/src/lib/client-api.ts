"use client";
import useSWR, { type SWRConfiguration } from "swr";
import { ApiError, extractFieldErrors } from "./api";

/** Client-portal browser calls go through the /api/client BFF proxy. */
const base = (path: string) => `/api/client/proxy/${path.replace(/^\//, "")}`;

async function parse(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/portal/login";
    }
    const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    throw new ApiError(res.status, msg ?? `Request failed (${res.status})`, extractFieldErrors(data));
  }
  return data;
}

export const clientApiGet = <T = unknown>(path: string): Promise<T> =>
  fetch(base(path), { credentials: "same-origin" }).then(parse);

export const clientApiSend = <T = unknown>(
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

export function useClientApi<T = unknown>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T>(path ? `client:${path}` : null, () => clientApiGet<T>(path as string), {
    revalidateOnFocus: false,
    ...config,
  });
}

export async function clientLogin(loginId: string, password: string, totp?: string) {
  const res = await fetch("/api/client/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId, password, totp }),
  });
  return parse(res);
}

export async function clientLogout() {
  await fetch("/api/client/auth/logout", { method: "POST" });
  window.location.href = "/portal/login";
}

/** Request a client password-reset link by login id. Generic (non-enumerating). */
export async function clientRequestReset(loginId: string) {
  const res = await fetch("/api/client/auth/request-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId }),
  });
  return parse(res);
}

/** Set a new client password using an emailed token. */
export async function clientResetPassword(token: string, newPassword: string) {
  const res = await fetch("/api/client/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  return parse(res);
}
