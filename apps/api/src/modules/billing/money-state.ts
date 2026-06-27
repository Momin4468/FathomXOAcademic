import { schema, sql, type Db } from "@business-os/db";
import { deriveMoneyState } from "@business-os/shared";
import { eq } from "drizzle-orm";

/**
 * Recompute a job's money_state from its billed lines + allocations (independent
 * of work_state — the two parallel closes). billed/allocated exclude void
 * invoices (a superseded estimate). Never stores amounts; only the status enum.
 */
export async function recomputeMoneyState(tx: Db, workItemId: string): Promise<void> {
  const res = await tx.execute(sql`
    with job_lines as (
      select il.id, il.amount
      from invoice_line il
      join invoice i on i.id = il.invoice_id
      join work_line wl on wl.id = il.work_line_id
      where wl.work_item_id = ${workItemId} and i.status <> 'void'
    )
    select
      coalesce((select sum(amount) from job_lines), 0) as billed,
      coalesce((select sum(pa.amount) from payment_allocation pa
                where pa.invoice_line_id in (select id from job_lines)), 0) as allocated
  `);
  const row = res.rows[0] as { billed: string; allocated: string };
  const state = deriveMoneyState({
    billedTotal: Number(row.billed),
    allocatedTotal: Number(row.allocated),
  });
  await tx
    .update(schema.workItem)
    .set({ moneyState: state, updatedAt: new Date() })
    .where(eq(schema.workItem.id, workItemId));
}

/** The work_item a given invoice_line ultimately belongs to (via its work_line). */
export async function workItemForInvoiceLine(tx: Db, invoiceLineId: string): Promise<string | null> {
  const res = await tx.execute(sql`
    select wl.work_item_id as "workItemId"
    from invoice_line il join work_line wl on wl.id = il.work_line_id
    where il.id = ${invoiceLineId}
  `);
  return (res.rows[0] as { workItemId: string } | undefined)?.workItemId ?? null;
}
