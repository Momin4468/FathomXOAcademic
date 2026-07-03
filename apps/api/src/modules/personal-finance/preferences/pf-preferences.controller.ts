import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { DbService } from "../../../common/db/db.service.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { UpdatePfPreferencesDto } from "./pf-preferences.dto.js";
import { PfPreferencesService } from "./pf-preferences.service.js";

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/preferences")
export class PfPreferencesController {
  constructor(
    private readonly db: DbService,
    private readonly prefs: PfPreferencesService,
  ) {}

  @Get()
  get(@CurrentPfAccount() p: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.prefs.get(tx, p.pfAccountId));
  }

  @Patch()
  update(@CurrentPfAccount() p: PfPrincipal, @Body() dto: UpdatePfPreferencesDto) {
    return this.db.withPfAccount({ pfAccountId: p.pfAccountId }, (tx) => this.prefs.update(tx, p.pfAccountId, dto));
  }
}
