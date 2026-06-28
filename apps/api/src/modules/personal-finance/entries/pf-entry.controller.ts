import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfExpenseDto, CreatePfIncomeDto, ListPfEntryQueryDto } from "./pf-entry.dto.js";
import { PfEntryService } from "./pf-entry.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf")
export class PfEntryController {
  constructor(
    private readonly db: DbService,
    private readonly entries: PfEntryService,
  ) {}

  @Post("income")
  createIncome(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfIncomeDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.entries.createIncome(tx, p.pfAccountId, dto));
  }

  @Get("income")
  listIncome(@CurrentPfAccount() p: PfPrincipal, @Query() q: ListPfEntryQueryDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.entries.listIncome(tx, q));
  }

  @Post("income/:id/reverse")
  reverseIncome(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.entries.reverseIncome(tx, p.pfAccountId, id));
  }

  @Post("expense")
  createExpense(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfExpenseDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.entries.createExpense(tx, p.pfAccountId, dto));
  }

  @Get("expense")
  listExpense(@CurrentPfAccount() p: PfPrincipal, @Query() q: ListPfEntryQueryDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.entries.listExpense(tx, q));
  }

  @Post("expense/:id/reverse")
  reverseExpense(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.entries.reverseExpense(tx, p.pfAccountId, id));
  }
}
