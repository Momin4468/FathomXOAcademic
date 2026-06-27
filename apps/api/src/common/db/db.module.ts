import { Global, Module } from "@nestjs/common";
import { createPool } from "@business-os/db";
import { PG_POOL } from "./db.constants.js";
import { DbService } from "./db.service.js";

/**
 * Global DB module: one app-role connection pool + the access layer service.
 * The pool connects as the NON-OWNER app role (DATABASE_URL), so RLS binds.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        return createPool(url);
      },
    },
    DbService,
  ],
  exports: [DbService],
})
export class DbModule {}
