import pg from "pg";
import { env } from "./env.js";

// Poll the admin connection until Postgres accepts queries (for db:reset).
async function main() {
  const deadline = Date.now() + 60_000;
  for (let attempt = 1; ; attempt++) {
    try {
      const client = new pg.Client({ connectionString: env.adminUrl });
      await client.connect();
      await client.query("select 1");
      await client.end();
      console.log("Postgres is ready.");
      return;
    } catch (err) {
      if (Date.now() > deadline) {
        console.error("Postgres not ready after 60s:", (err as Error).message);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
      if (attempt % 5 === 0) console.log(`waiting for Postgres… (${attempt}s)`);
    }
  }
}

main();
