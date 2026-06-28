import { Injectable } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import type { IncomeBridgePort, PushPayoutArgs } from "./income-bridge.port.js";

/**
 * The deployed-together adapter for the income bridge (§11). Calls the
 * pf_push_income() SECURITY DEFINER in the SAME business transaction: the income
 * appears exactly when the payout commits, idempotent on source_ref, and the
 * function returns nothing — the business learns nothing about the PF plane (not
 * even whether a linked account exists). A future HttpIncomeBridge replaces this
 * for a physical split; PaymentService is unchanged.
 */
@Injectable()
export class DbIncomeBridge implements IncomeBridgePort {
  async pushPayout(tx: Db, args: PushPayoutArgs): Promise<void> {
    await tx.execute(sql`
      select pf_push_income(
        ${args.partyId}::uuid,
        ${args.amount}::numeric,
        ${args.currency},
        ${args.occurredOn}::date,
        ${args.sourceRef}
      )
    `);
  }
}
