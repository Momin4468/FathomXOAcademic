import type { Db } from "@business-os/db";

/** DI token for the one-way income bridge (so billing depends on the seam, not PF). */
export const INCOME_BRIDGE = Symbol("INCOME_BRIDGE");

export interface PushPayoutArgs {
  /** The business party that was paid (resolved to a linked PF account, if any). */
  partyId: string;
  /** Amount paid (negative for a reversal mirror — income nets to zero). */
  amount: number;
  currency: string;
  /** Payout date (YYYY-MM-DD). */
  occurredOn: string;
  /** The originating payment_allocation id — the idempotency key on the PF side. */
  sourceRef: string;
}

/**
 * THE ONE-WAY INCOME BRIDGE (DESIGN_SPEC §11). The business plane depends only on
 * this port; it pushes a payout INTO the personal-finance plane and can never read
 * back. The DB adapter runs the push in the current business transaction today; a
 * later physical split swaps in an HTTP adapter with no change to billing.
 */
export interface IncomeBridgePort {
  pushPayout(tx: Db, args: PushPayoutArgs): Promise<void>;
}
