"use client";
import { ApiError, apiSend } from "./api";
import type { FileMeta } from "./types";

/** Register a large file / video as a link only (no upload) — the file rule. */
export function linkFile(url: string, kind: string): Promise<FileMeta> {
  return apiSend<FileMeta>("files/link", "POST", { url, kind });
}

/** Upload a small file through the multipart BFF route → file_object metadata. */
export async function uploadFile(file: File, kind: string): Promise<FileMeta> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch("/api/upload", { method: "POST", credentials: "same-origin", body: form });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    throw new ApiError(res.status, msg ?? `Upload failed (${res.status})`);
  }
  return data as FileMeta;
}

/** A stored file/image streams back through the binary-safe download route. */
export const fileSrc = (id: string) => `/api/files/${id}`;
