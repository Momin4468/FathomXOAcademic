"use client";
import useSWR, { type SWRConfiguration } from "swr";
import { ApiError } from "./api";

/** All PF browser calls go through the SEPARATE PF BFF proxy; tokens stay server-side. */
const base = (path: string) => `/api/pf/proxy/${path.replace(/^\//, "")}`;

async function parse(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/personal-finance/login";
    }
    const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    throw new ApiError(res.status, msg ?? `Request failed (${res.status})`);
  }
  return data;
}

export const pfApiGet = <T = unknown>(path: string): Promise<T> =>
  fetch(base(path), { credentials: "same-origin" }).then(parse);

export const pfApiSend = <T = unknown>(
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

/** SWR read hook for the PF plane. `path=null` skips the fetch. */
export function usePfApi<T = unknown>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T>(path ? `pf:${path}` : null, () => pfApiGet<T>(path as string), {
    revalidateOnFocus: false,
    ...config,
  });
}

export async function pfLogin(email: string, password: string, totp?: string) {
  const res = await fetch("/api/pf/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, totp }),
  });
  return parse(res);
}

export async function pfRegister(email: string, password: string, displayName?: string, baseCurrency?: string) {
  const res = await fetch("/api/pf/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName, baseCurrency }),
  });
  return parse(res);
}

export async function pfLogout() {
  await fetch("/api/pf/auth/logout", { method: "POST" });
  window.location.href = "/personal-finance/login";
}

/** Request a PF password-reset link. Always resolves (generic, non-enumerating). */
export async function pfRequestReset(email: string) {
  const res = await fetch("/api/pf/auth/request-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return parse(res);
}

/** Set a new PF password using an emailed token. */
export async function pfResetPassword(token: string, newPassword: string) {
  const res = await fetch("/api/pf/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  return parse(res);
}
