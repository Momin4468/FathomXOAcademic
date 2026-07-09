import { ApiError } from "./api";

/**
 * Build a `{ field → message }` lookup from a thrown request error so a form can
 * attach each validation message to its own `<Field error={…}>`.
 *
 * Returns `{}` for anything that isn't an {@link ApiError} carrying structured
 * `fieldErrors` — network failures, 500s and plain `Error`s have no per-field
 * detail, so they stay in the combined `ErrorNote` banner instead. When the API
 * reports the same field twice, the first message wins (a form shows one error
 * per field).
 */
export function fieldErrorMap(err: unknown): Record<string, string> {
  const fieldErrors = err instanceof ApiError ? err.fieldErrors : undefined;
  const map: Record<string, string> = {};
  for (const fe of fieldErrors ?? []) {
    if (!(fe.field in map)) map[fe.field] = fe.message;
  }
  return map;
}

/**
 * True when the error carries at least one per-field message. Forms use this to
 * decide whether to also show the fallback banner: when every part of the
 * failure is already pinned to a field, the banner is redundant.
 */
export function hasFieldErrors(err: unknown): boolean {
  return err instanceof ApiError && !!err.fieldErrors && err.fieldErrors.length > 0;
}

/**
 * The message for the fallback `ErrorNote` banner. Returns `undefined` when the
 * failure is fully described by per-field errors (so the banner is hidden);
 * otherwise the error's own message, or `fallback` for non-`Error` throws.
 */
export function bannerMessage(err: unknown, fallback = "Something went wrong"): string | undefined {
  if (err == null) return undefined;
  if (hasFieldErrors(err)) return undefined;
  return err instanceof Error ? err.message : fallback;
}
