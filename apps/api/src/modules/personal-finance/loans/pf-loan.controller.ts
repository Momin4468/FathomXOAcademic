import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfLoanDto, CreatePfLoanEventDto } from "./pf-loan.dto.js";
import { PfLoanService } from "./pf-loan.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/loans")
export class PfLoanController {
  constructor(
    private readonly db: DbService,
    private readonly loans: PfLoanService,
  ) {}

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfLoanDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.loans.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.loans.list(tx, p.pfAccountId));
  }

  @Get(":id/events")
  events(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.loans.events(tx, id));
  }

  @Post(":id/events")
  addEvent(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreatePfLoanEventDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.loans.addEvent(tx, p.pfAccountId, id, dto));
  }

  @Post("events/:eventId/reverse")
  reverseEvent(@CurrentPfAccount() p: PfPrincipal, @Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.loans.reverseEvent(tx, p.pfAccountId, eventId));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.loans.archive(tx, p.pfAccountId, id));
  }
}
