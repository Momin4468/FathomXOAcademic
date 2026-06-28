import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { CreatePfCategoryDto, ListPfCategoryQueryDto, UpdatePfCategoryDto } from "./pf-category.dto.js";
import { PfCategoryService } from "./pf-category.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/categories")
export class PfCategoryController {
  constructor(
    private readonly db: DbService,
    private readonly categories: PfCategoryService,
  ) {}

  @Post()
  create(@CurrentPfAccount() p: PfPrincipal, @Body() dto: CreatePfCategoryDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.categories.create(tx, p.pfAccountId, dto));
  }

  @Get()
  list(@CurrentPfAccount() p: PfPrincipal, @Query() q: ListPfCategoryQueryDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.categories.list(tx, p.pfAccountId, q));
  }

  @Patch(":id")
  rename(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePfCategoryDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.categories.rename(tx, p.pfAccountId, id, dto));
  }

  @Post(":id/archive")
  archive(@CurrentPfAccount() p: PfPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.categories.archive(tx, p.pfAccountId, id));
  }
}
