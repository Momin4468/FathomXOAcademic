import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  ApplyPlatformFeeDto,
  ListTransfersQueryDto,
  RecordTransferDto,
  ReverseTransferDto,
  SettlementQueryDto,
} from "./dto.js";
import { SettlementService } from "./settlement.service.js";

/**
 * Settlement (DESIGN_SPEC §4.4) — the shared partner picture. Gated by the
 * existing billing:* module (both partners are Admins). The §4.4 opacity is
 * enforced in the DB: settlement_legs() only returns the shared pool to the two
 * partners and never the other's private legs.
 */
@Controller("settlement")
export class SettlementController {
  constructor(
    private readonly db: DbService,
    private readonly settlement: SettlementService,
  ) {}

  /** Shared settlement summary + net who-owes-whom for the partner pair. */
  @Get()
  @RequirePermission("billing", "view")
  summary(@CurrentRls() ctx: RlsContext, @Query() q: SettlementQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.settlement.summary(tx, q.partnerA, q.partnerB));
  }

  @Get("transfers")
  @RequirePermission("billing", "view")
  listTransfers(@CurrentRls() ctx: RlsContext, @Query() q: ListTransfersQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.settlement.listTransfers(tx, q.partyId));
  }

  @Post("transfers")
  @RequirePermission("billing", "create")
  recordTransfer(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: RecordTransferDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.settlement.recordTransfer(tx, p, dto));
  }

  @Post("transfers/reverse")
  @RequirePermission("billing", "approve")
  reverseTransfer(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: ReverseTransferDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.settlement.reverseTransfer(tx, p, dto.originalId, dto.reason));
  }

  /** Apply the platform/system fee (deal-term → party-owes-business charge). */
  @Post("platform-fee")
  @RequirePermission("billing", "create")
  applyPlatformFee(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: ApplyPlatformFeeDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.settlement.applyPlatformFee(tx, p, dto));
  }
}
