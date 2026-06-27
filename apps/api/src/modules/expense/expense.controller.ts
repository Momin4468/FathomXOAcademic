import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from "./dto.js";
import { ExpenseService } from "./expense.service.js";

@Controller("expenses")
export class ExpenseController {
  constructor(
    private readonly db: DbService,
    private readonly expenses: ExpenseService,
  ) {}

  @Post()
  @RequirePermission("expenses", "create")
  create(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateExpenseDto) {
    return this.db.withTenant(ctx, (tx) => this.expenses.create(tx, p, dto));
  }

  @Patch(":id")
  @RequirePermission("expenses", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.expenses.update(tx, p, id, dto));
  }

  @Get()
  @RequirePermission("expenses", "view")
  list(@CurrentRls() ctx: RlsContext, @Query() q: ListExpensesQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.expenses.list(tx, q));
  }

  @Get(":id")
  @RequirePermission("expenses", "view")
  getById(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.expenses.getById(tx, id));
  }
}
