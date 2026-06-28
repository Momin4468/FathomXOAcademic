import { Controller, Get, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { PfDashboardService } from "./pf-dashboard.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/dashboard")
export class PfDashboardController {
  constructor(
    private readonly db: DbService,
    private readonly dashboard: PfDashboardService,
  ) {}

  @Get()
  overview(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.dashboard.overview(tx, p.pfAccountId));
  }
}
