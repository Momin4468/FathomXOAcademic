import { Injectable, Logger } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import { formatDate } from "@business-os/shared";
import { Cron } from "@nestjs/schedule";
import { AuditService } from "../../common/audit/audit.service.js";
import { DbService } from "../../common/db/db.service.js";
import { EmailService } from "../../common/email/email.service.js";

/** Lead time: remind this many days before the next payment. */
const LEAD_DAYS = 3;

interface DueRow {
  id: string;
  amount: string;
  currency: string | null;
  nextDueDate: string; // YYYY-MM-DD
  note: string | null;
  recipient: string | null; // created_by user's email
}

/**
 * Subscription reminders (§8). Fires an email LEAD_DAYS before a subscription
 * expense's next_due_date, once per due-date (idempotent via last_reminded_due).
 * Runs daily via @Cron (per-org, under each org's RLS — no admin creds, no
 * cross-org read) and on demand via POST /reminders/run for the caller's org.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  /** Daily at 09:00 server time — sweep every org. */
  @Cron("0 9 * * *")
  async daily(): Promise<void> {
    try {
      const n = await this.runAll();
      if (n > 0) this.logger.log(`subscription reminders sent: ${n}`);
    } catch (e) {
      this.logger.error(`reminder sweep failed: ${(e as Error).message}`);
    }
  }

  /** Sweep all tenants — each org's work runs under its own RLS context. */
  async runAll(): Promise<number> {
    // The cron has no request context; enumerate orgs via the ids-only definer.
    const system = { orgId: "00000000-0000-0000-0000-000000000000", partyId: null, isSuperadmin: false };
    const orgRows = await this.db.withTenant(system, (tx) =>
      tx.execute(sql`select id from reminder_org_ids()`),
    );
    let total = 0;
    for (const r of orgRows.rows as Array<{ id: string }>) {
      total += await this.db.withTenant(
        { orgId: r.id, partyId: null, isSuperadmin: false },
        (tx) => this.runForOrg(tx, r.id, null),
      );
    }
    return total;
  }

  /** Send reminders for subscriptions due in LEAD_DAYS in ONE org (RLS-scoped). */
  async runForOrg(tx: Db, orgId: string, actorUserId: string | null): Promise<number> {
    const res = await tx.execute(sql`
      select e.id, e.amount, e.currency, e.next_due_date as "nextDueDate",
             e.note, u.email as recipient
      from expense e
      left join user_account u on u.id = e.created_by
      where e.category = 'subscription'
        and e.archived_at is null
        and e.next_due_date is not null
        and e.next_due_date = (current_date + (${LEAD_DAYS})::int)
        and e.last_reminded_due is distinct from e.next_due_date
    `);
    const rows = res.rows as unknown as DueRow[];
    let sent = 0;
    for (const row of rows) {
      if (!row.recipient) {
        this.logger.warn(`subscription ${row.id} has no recipient email — skipped`);
        continue;
      }
      const currency = row.currency ?? "BDT";
      const due = formatDate(row.nextDueDate);
      await this.email.send({
        to: row.recipient,
        subject: `Subscription due ${due} — ${currency} ${row.amount}`,
        text:
          `A subscription payment is due on ${due}.\n` +
          `Amount: ${currency} ${row.amount}\n` +
          (row.note ? `Note: ${row.note}\n` : "") +
          `\n(Reminder sent ${LEAD_DAYS} days before the due date.)`,
      });
      // Idempotent: mark this due-date reminded so a re-run won't re-send.
      await tx.execute(sql`
        update expense set last_reminded_due = next_due_date where id = ${row.id}
      `);
      await this.audit.record(tx, orgId, {
        actorUserId,
        action: "reminder.sent",
        entity: "expense",
        entityId: row.id,
        detail: { nextDueDate: row.nextDueDate, currency, amount: row.amount },
      });
      sent += 1;
    }
    return sent;
  }
}
