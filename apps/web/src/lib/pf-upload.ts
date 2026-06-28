"use client";
import { ApiError } from "./api";
import type { PfNoteAttachment } from "./pf-types";

/** Upload a file to a note via the PF multipart seam (PF session cookies). */
export async function pfUploadNoteFile(noteId: string, file: File): Promise<PfNoteAttachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/pf/upload/${noteId}`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/personal-finance/login";
    const msg = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    throw new ApiError(res.status, msg ?? `Upload failed (${res.status})`);
  }
  return data as PfNoteAttachment;
}

/** The in-app download URL for a stored attachment (link attachments use their own url). */
export const pfAttachmentDownloadUrl = (id: string) => `/api/pf/files/${id}`;
