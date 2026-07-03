import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { PfInsightsService } from "./pf-insights.service.js";

/** Optional per-request period override for the overview's period selector. */
class InsightsQueryDto {
  @IsOptional() @IsIn(["week", "month", "custom"]) period?: "week" | "month" | "custom";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(366) days?: number;
}

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/insights")
export class PfInsightsController {
  constructor(
    private readonly db: DbService,
    private readonly insights: PfInsightsService,
  ) {}

  @Get()
  overview(@CurrentPfAccount() p: PfPrincipal, @Query() q: InsightsQueryDto) {
    const override = q.period ? { rollupPeriod: q.period, rollupCustomDays: q.days ?? 30 } : undefined;
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.insights.overview(tx, p.pfAccountId, override));
  }
}
