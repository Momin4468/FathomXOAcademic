import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfCashCheckinDto } from "./pf-cash.dto.js";
import { PfCashService } from "./pf-cash.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/cash")
export class PfCashController {
  constructor(
    private readonly db: DbService,
    private readonly cash: PfCashService,
  ) {}

  @Post("checkins")
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfCashCheckinDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.cash.createCheckin(tx, p.pfAccountId, dto));
  }

  @Get("checkins")
  list(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.cash.listCheckins(tx));
  }

  /** Latest declared cash vs. the ledger-implied expectation (derived; informational). */
  @Get("reconcile")
  reconcile(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.cash.reconcile(tx, p.pfAccountId));
  }
}
