import { Injectable, Logger } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import { formatDate } from "@business-os/shared";
import { Cron } from "@nestjs/schedule";
import { DbService } from "../../../common/db/db.service.js";
import { EmailService } from "../../../common/email/email.service.js";
import { PfAuditService } from "../pf-audit.service.js";
import { PfPreferencesService } from "../preferences/pf-preferences.service.js";

interface PfDueRow {
  id: string;
  amount: string;
  currency: string | null;
  nextDueDate: string;
  name: string;
}

/**
 * Personal-finance subscription reminders (§11). Mirrors the business reminder
 * runner but scoped per PF ACCOUNT (under each account's RLS) and REUSES the
 * same swappable EmailService — no second email pipeline. The recipient is the
 * account's own email. Idempotent per due-date via last_reminded_due.
 */
@Injectable()
export class PfReminderService {
  private readonly logger = new Logger(PfReminderService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
    private readonly audit: PfAuditService,
    private readonly prefs: PfPreferencesService,
  ) {}

  /** Daily at 09:15 server time — sweep every active PF account. */
  @Cron("15 9 * * *")
  async daily(): Promise<void> {
    try {
      const n = await this.runAll();
      if (n > 0) this.logger.log(`pf subscription reminders sent: ${n}`);
    } catch (e) {
      this.logger.error(`pf reminder sweep failed: ${(e as Error).message}`);
    }
  }

  /** Enumerate PF tenants (ids-only definer) and sweep each under its own RLS. */
  async runAll(): Promise<number> {
    const ids = await this.db.withPfAccount({ pfAccountId: "00000000-0000-0000-0000-000000000000" }, (tx) =>
      tx.execute(sql`select id from pf_reminder_account_ids()`),
    );
    let total = 0;
    for (const r of ids.rows as Array<{ id: string }>) {
      total += await this.db.withPfAccount({ pfAccountId: r.id }, (tx) => this.runForAccount(tx, r.id));
    }
    return total;
  }

  /** Send reminders for subscriptions due in the account's lead window. */
  async runForAccount(tx: Db, pfAccountId: string): Promise<number> {
    const prefs = await this.prefs.ensure(tx, pfAccountId);
    if (!prefs.reminderSubscriptions) return 0;
    const leadDays = prefs.subscriptionLeadDays;

    const acct = await tx.execute(sql`select email from pf_account where id = ${pfAccountId}`);
    const recipient = (acct.rows[0] as { email: string } | undefined)?.email;
    if (!recipient) return 0;

    const res = await tx.execute(sql`
      select id, amount, currency, next_due_date as "nextDueDate", name
      from pf_subscription
      where archived_at is null
        and next_due_date is not null
        and next_due_date = (current_date + (${leadDays})::int)
        and last_reminded_due is distinct from next_due_date
    `);
    const rows = res.rows as unknown as PfDueRow[];
    let sent = 0;
    for (const row of rows) {
      const currency = row.currency ?? "BDT";
      const due = formatDate(row.nextDueDate);
      await this.email.send({
        to: recipient,
        subject: `${row.name} due ${due} — ${currency} ${row.amount}`,
        text:
          `Your subscription "${row.name}" is due on ${due}.\n` +
          `Amount: ${currency} ${row.amount}\n` +
          `\n(Reminder sent ${leadDays} days before the due date.)`,
      });
      await tx.execute(sql`update pf_subscription set last_reminded_due = next_due_date where id = ${row.id}`);
      await this.audit.record(tx, pfAccountId, {
        action: "pf.reminder_sent",
        entity: "pf_subscription",
        entityId: row.id,
        detail: { nextDueDate: row.nextDueDate, currency, amount: row.amount },
      });
      sent += 1;
    }
    return sent;
  }
}
