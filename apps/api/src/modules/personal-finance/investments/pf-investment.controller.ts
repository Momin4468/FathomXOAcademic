import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfInvestmentDto, CreatePfInvestmentEventDto } from "./pf-investment.dto.js";
import { PfInvestmentService } from "./pf-investment.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/investments")
export class PfInvestmentController {
  constructor(
    private readonly db: DbService,
    private readonly investments: PfInvestmentService,
  ) {}

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfInvestmentDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.investments.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.investments.list(tx, p.pfAccountId));
  }

  @Get(":id/events")
  events(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.investments.events(tx, id));
  }

  @Post(":id/events")
  addEvent(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreatePfInvestmentEventDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.investments.addEvent(tx, p.pfAccountId, id, dto));
  }

  @Post("events/:eventId/reverse")
  reverseEvent(@CurrentPfAccount() p: PfPrincipal, @Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.investments.reverseEvent(tx, p.pfAccountId, eventId));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.investments.archive(tx, p.pfAccountId, id));
  }
}
