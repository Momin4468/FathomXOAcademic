import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { PfAnomalyReminderService } from "./pf-anomaly-reminder.service.js";
import { PfAnomalyService } from "./pf-anomaly.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/anomaly-notices")
export class PfAnomalyController {
  constructor(
    private readonly db: DbService,
    private readonly anomaly: PfAnomalyService,
    private readonly reminder: PfAnomalyReminderService,
  ) {}

  /** Run the anomaly check for THIS account now (same-account; mirrors the
   *  subscription/note "run" triggers). Idempotent — deduped per scope/period. */
  @Post("run")
  @HttpCode(200)
  async run(@CurrentPfAccount() p: PfPrincipal) {
    const raised = await this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.reminder.runForAccount(tx, p.pfAccountId));
    return { raised };
  }

  @Post(":id/dismiss")
  @HttpCode(200)
  dismiss(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.anomaly.dismiss(tx, p.pfAccountId, id));
  }
}
