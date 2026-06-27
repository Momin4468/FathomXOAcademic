import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { withRlsTransaction, type Db } from "@business-os/db";
import type { RlsContext } from "@business-os/shared";
import type pg from "pg";
import { PG_POOL } from "./db.constants.js";

/**
 * The single data access layer (CLAUDE.md §3.1). All DB work goes through
 * `withTenant`, which opens a transaction, sets the RLS session GUCs from the
 * request's security context, and only then runs the callback — so the database
 * enforces visibility, not the application.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  withTenant<T>(ctx: RlsContext, fn: (tx: Db) => Promise<T>): Promise<T> {
    return withRlsTransaction(this.pool, ctx, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
