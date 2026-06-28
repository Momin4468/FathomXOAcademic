import { Injectable, Logger } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import { Cron } from "@nestjs/schedule";
import { DbService } from "../../../common/db/db.service.js";
import { EmailService } from "../../../common/email/email.service.js";
import { PfAuditService } from "../pf-audit.service.js";

interface DueNote {
  id: string;
  title: string | null;
  body: string | null;
  remindOn: string;
}

/**
 * Personal-note reminders (§11). Emails the account on the day a note's remind_on
 * falls due. Mirrors the PF subscription reminder: per-account sweep under RLS,
 * reuses the shared EmailService (no second pipeline), idempotent via
 * last_reminded_on. Recipient = the account's own email.
 */
@Injectable()
export class PfNoteReminderService {
  private readonly logger = new Logger(PfNoteReminderService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
    private readonly audit: PfAuditService,
  ) {}

  /** Daily at 09:30 server time — sweep every active PF account. */
  @Cron("30 9 * * *")
  async daily(): Promise<void> {
    try {
      const n = await this.runAll();
      if (n > 0) this.logger.log(`pf note reminders sent: ${n}`);
    } catch (e) {
      this.logger.error(`pf note reminder sweep failed: ${(e as Error).message}`);
    }
  }

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

  /** Email notes due TODAY for ONE account; stamp last_reminded_on (idempotent). */
  async runForAccount(tx: Db, pfAccountId: string): Promise<number> {
    const acct = await tx.execute(sql`select email from pf_account where id = ${pfAccountId}`);
    const recipient = (acct.rows[0] as { email: string } | undefined)?.email;
    if (!recipient) return 0;

    const res = await tx.execute(sql`
      select id, title, body, remind_on as "remindOn"
      from pf_note
      where archived_at is null
        and remind_on is not null
        and remind_on = current_date
        and last_reminded_on is distinct from remind_on
    `);
    const rows = res.rows as unknown as DueNote[];
    let sent = 0;
    for (const row of rows) {
      const title = row.title?.trim() || "(untitled note)";
      await this.email.send({
        to: recipient,
        subject: `Reminder: ${title}`,
        text: `Your note "${title}" is due today.\n` + (row.body ? `\n${row.body}\n` : ""),
      });
      await tx.execute(sql`update pf_note set last_reminded_on = remind_on where id = ${row.id}`);
      await this.audit.record(tx, pfAccountId, { action: "pf.note_reminder_sent", entity: "pf_note", entityId: row.id, detail: { remindOn: row.remindOn } });
      sent += 1;
    }
    return sent;
  }
}
