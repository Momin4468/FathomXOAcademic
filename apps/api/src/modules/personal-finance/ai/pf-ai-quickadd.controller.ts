import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { PfAiQuickAddService } from "./pf-ai-quickadd.service.js";

class PfAiQuickAddDto {
  @IsString() @MinLength(1) @MaxLength(500) text!: string;
}

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/ai")
export class PfAiQuickAddController {
  constructor(
    private readonly db: DbService,
    private readonly ai: PfAiQuickAddService,
  ) {}

  /** Returns a DRAFT expense (proposals only). The user confirms via POST /pf/expense. */
  @Post("quick-add")
  @HttpCode(200)
  quickAdd(@CurrentPfAccount() p: PfPrincipal, @Body() dto: PfAiQuickAddDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.ai.draft(tx, p.pfAccountId, dto.text));
  }
}
