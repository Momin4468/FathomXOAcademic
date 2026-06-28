import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfSavingDto, CreatePfSavingEventDto } from "./pf-saving.dto.js";
import { PfSavingService } from "./pf-saving.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/savings")
export class PfSavingController {
  constructor(
    private readonly db: DbService,
    private readonly savings: PfSavingService,
  ) {}

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfSavingDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.savings.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.savings.list(tx, p.pfAccountId));
  }

  @Get(":id/events")
  events(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.savings.events(tx, id));
  }

  @Post(":id/events")
  addEvent(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreatePfSavingEventDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.savings.addEvent(tx, p.pfAccountId, id, dto));
  }

  @Post("events/:eventId/reverse")
  reverseEvent(@CurrentPfAccount() p: PfPrincipal, @Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.savings.reverseEvent(tx, p.pfAccountId, eventId));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.savings.archive(tx, p.pfAccountId, id));
  }
}
