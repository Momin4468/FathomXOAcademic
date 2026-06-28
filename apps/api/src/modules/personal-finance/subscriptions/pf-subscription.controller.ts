import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfSubscriptionDto, UpdatePfSubscriptionDto } from "./pf-subscription.dto.js";
import { PfReminderService } from "./pf-reminder.service.js";
import { PfSubscriptionService } from "./pf-subscription.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/subscriptions")
export class PfSubscriptionController {
  constructor(
    private readonly db: DbService,
    private readonly subscriptions: PfSubscriptionService,
    private readonly reminders: PfReminderService,
  ) {}

  /** Manually fire due reminders for THIS account (the daily @Cron sweeps all). */
  @Post("reminders/run")
  runReminders(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, async (tx) => ({
      sent: await this.reminders.runForAccount(tx, p.pfAccountId),
    }));
  }

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfSubscriptionDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.subscriptions.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.subscriptions.list(tx, p.pfAccountId));
  }

  @Patch(":id")
  update(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePfSubscriptionDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.subscriptions.update(tx, p.pfAccountId, id, dto));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.subscriptions.archive(tx, p.pfAccountId, id));
  }
}
