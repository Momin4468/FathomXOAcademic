import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Side-effect module: load the repo-root .env. Import this FIRST in main.ts so
// it runs before any module reads process.env (ESM evaluates imports in order).
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv });
