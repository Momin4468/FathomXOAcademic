import type { ValidationError } from "class-validator";

/**
 * A single per-field validation failure. `field` is the dotted path to the
 * offending property (e.g. `amount`, `lines.0.rate`), `message` is one
 * human-readable constraint message for that field.
 */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Flatten class-validator's nested `ValidationError[]` into:
 *  - `messages`: the flat list of every constraint message (the shape Nest's
 *    default ValidationPipe already produces — preserved for back-compat), and
 *  - `fieldErrors`: one `{ field, message }` per constraint, with a dotted path
 *    that walks into nested objects/arrays so the frontend can attach each
 *    message to the input that produced it.
 *
 * A field with multiple failed constraints yields the first constraint message
 * in `fieldErrors` (a form shows one error per field) while `messages` keeps
 * every message (so nothing the old response carried is lost).
 */
export function flattenValidationErrors(errors: ValidationError[]): {
  messages: string[];
  fieldErrors: FieldError[];
} {
  const messages: string[] = [];
  const fieldErrors: FieldError[] = [];

  const walk = (errs: ValidationError[], prefix: string): void => {
    // Defensive: this runs in front of the login endpoint and every form, so a
    // malformed error shape must degrade to an empty result, never throw (a throw
    // here turns a clean 400 into an unhandled 500). class-validator always hands
    // us arrays; the guard just makes that assumption un-break-able.
    if (!Array.isArray(errs)) return;
    for (const err of errs) {
      const path = prefix ? `${prefix}.${err.property}` : err.property;
      const constraintMessages = err.constraints ? Object.values(err.constraints) : [];
      // Every constraint message flows into `messages` (matches the default pipe).
      for (const m of constraintMessages) messages.push(m);
      // One entry per field in `fieldErrors` — the first message is the one shown.
      const [firstMessage] = constraintMessages;
      if (firstMessage !== undefined) {
        fieldErrors.push({ field: path, message: firstMessage });
      }
      // Recurse into nested DTOs / arrays (err.children carries the sub-errors).
      if (Array.isArray(err.children) && err.children.length > 0) {
        walk(err.children, path);
      }
    }
  };

  walk(errors, "");
  return { messages, fieldErrors };
}
