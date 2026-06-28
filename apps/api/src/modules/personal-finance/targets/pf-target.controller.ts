import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfTargetDto } from "./pf-target.dto.js";
import { PfTargetService } from "./pf-target.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/targets")
export class PfTargetController {
  constructor(
    private readonly db: DbService,
    private readonly targets: PfTargetService,
  ) {}

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfTargetDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.targets.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.targets.list(tx, p.pfAccountId));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.targets.archive(tx, p.pfAccountId, id));
  }
}
