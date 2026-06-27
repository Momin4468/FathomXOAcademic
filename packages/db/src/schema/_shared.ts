import { customType } from "drizzle-orm/pg-core";

/** Postgres citext (case-insensitive text) — used for emails. */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});
