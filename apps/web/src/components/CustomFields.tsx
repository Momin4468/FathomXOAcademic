"use client";
import { type CustomFieldOnRecord } from "@/lib/types";
import { DateInput, Field, Input, Select } from "./ui";

/**
 * Renders a record's applicable custom fields as typed inputs and reports the
 * value map back. `fields` comes from a record detail's `customFields`
 * (describeForRecord). Submit the emitted object as the record's `customJson`.
 * Structured + governed — kept distinct from the free-form notes field.
 */
export function CustomFields({
  fields,
  values,
  onChange,
}: {
  fields: CustomFieldOnRecord[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) return null;
  const set = (id: string, v: unknown) => onChange({ ...values, [id]: v });
  const val = (f: CustomFieldOnRecord) => (values[f.id] ?? f.value ?? "") as string | number;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Custom fields</h2>
      {fields.map((f) => {
        const label = `${f.fieldName}${f.required ? " *" : ""}`;
        const hint = f.missingRequired ? "required — incomplete" : undefined;
        if (f.fieldType === "select") {
          return (
            <Field key={f.id} label={label} hint={hint}>
              <Select value={String(val(f) ?? "")} onChange={(e) => set(f.id, e.target.value || null)}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
          );
        }
        if (f.fieldType === "bool") {
          return (
            <label key={f.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!(values[f.id] ?? f.value)} onChange={(e) => set(f.id, e.target.checked)} />
              {label}
            </label>
          );
        }
        if (f.fieldType === "date") {
          return (
            <Field key={f.id} label={label} hint={hint}>
              <DateInput value={String(val(f) ?? "")} onChange={(v) => set(f.id, v || null)} />
            </Field>
          );
        }
        if (f.fieldType === "number") {
          return (
            <Field key={f.id} label={label} hint={hint}>
              <Input type="number" value={String(val(f) ?? "")} onChange={(e) => set(f.id, e.target.value === "" ? null : Number(e.target.value))} />
            </Field>
          );
        }
        return (
          <Field key={f.id} label={label} hint={hint}>
            <Input value={String(val(f) ?? "")} onChange={(e) => set(f.id, e.target.value || null)} />
          </Field>
        );
      })}
    </div>
  );
}
