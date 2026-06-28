import { Controller, HttpCode, Post } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { PersonalLinkService } from "./personal-link.service.js";

/**
 * "Connect my income to Personal Finance" — a business user mints a link code for
 * their own party (§11). Authenticated (global business guard); no special
 * permission — it only ever touches the caller's own party.
 */
@Controller("me/personal-finance")
export class PersonalLinkController {
  constructor(
    private readonly db: DbService,
    private readonly link: PersonalLinkService,
  ) {}

  @Post("link-token")
  @HttpCode(201)
  mint(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.link.mintLinkToken(tx, p));
  }
}
