"use client";
import useSWR, { mutate, type SWRConfiguration } from "swr";
import { ApiError } from "./api";
import type { PfExpenseDraft } from "./pf-types";

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

/** Revalidate every PF SWR key (after a mutation like quick-add). */
export function pfRevalidate() {
  return mutate((key) => typeof key === "string" && key.startsWith("pf:"));
}

/** Record an expense (used by quick-add). Reuses POST /pf/expense. */
export async function pfAddExpense(body: {
  amount: number;
  categoryId?: string | null;
  currency?: string;
  occurredOn: string;
  note?: string | null;
}) {
  const row = await pfApiSend("expense", "POST", body);
  await pfRevalidate();
  return row;
}

/** Turn a typed line into a DRAFT expense (proposals only; user confirms). */
export function pfAiQuickAdd(text: string): Promise<{ draft: PfExpenseDraft | null; note?: string }> {
  return pfApiSend("ai/quick-add", "POST", { text });
}

/** Dismiss an in-app anomaly notice. */
export async function pfDismissAnomaly(id: string) {
  const r = await pfApiSend(`anomaly-notices/${id}/dismiss`, "POST");
  await pfRevalidate();
  return r;
}
