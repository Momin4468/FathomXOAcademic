import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { BalanceService } from "./balance.service.js";
import { ChargeService } from "./charge.service.js";
import {
  AllocateDto,
  AttachLineDto,
  AttachProofDto,
  CreateChargeDto,
  CreateInvoiceDto,
  CreateOtherIncomeDto,
  InvoiceFromLinesDto,
  ListChargesQueryDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  MoveLineDto,
  RecordPaymentDto,
  ReverseChargeDto,
  ReverseOtherIncomeDto,
  ReversePaymentDto,
} from "./dto.js";
import { InvoiceService } from "./invoice.service.js";
import { OtherIncomeService } from "./other-income.service.js";
import { PaymentService } from "./payment.service.js";

@Controller()
export class BillingController {
  constructor(
    private readonly db: DbService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
    private readonly charges: ChargeService,
    private readonly balances: BalanceService,
    private readonly otherIncome: OtherIncomeService,
  ) {}

  // ── invoices ──
  @Post("invoices")
  @RequirePermission("billing", "create")
  createInvoice(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateInvoiceDto) {
    return this.db.withTenant(ctx, (tx) => this.invoices.createInvoice(tx, p, dto.clientPartyId, dto.isEstimate ?? false));
  }

  @Post("invoices/attach-line")
  @RequirePermission("billing", "create")
  attachLine(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: AttachLineDto) {
    return this.db.withTenant(ctx, (tx) =>
      dto.invoiceId
        ? this.invoices.addLineToInvoice(tx, p, dto.invoiceId, dto.workLineId)
        : this.invoices.attachLine(tx, p, dto.workLineId),
    );
  }

  /** Build a new invoice from selected billable lines (Client-360 invoice popup). */
  @Post("invoices/from-lines")
  @RequirePermission("billing", "create")
  invoiceFromLines(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: InvoiceFromLinesDto) {
    return this.db.withTenant(ctx, (tx) => this.invoices.createInvoiceFromLines(tx, p, dto.clientPartyId, dto.workLineIds));
  }

  @Post("invoices/move-line")
  @RequirePermission("billing", "edit")
  moveLine(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: MoveLineDto) {
    return this.db.withTenant(ctx, (tx) => this.invoices.moveLine(tx, p, dto.invoiceLineId, dto.targetInvoiceId));
  }

  @Post("invoices/:id/supersede")
  @RequirePermission("billing", "edit")
  supersede(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.invoices.supersedeWithFinal(tx, p, id));
  }

  @Get("invoices")
  @RequirePermission("billing", "view")
  listInvoices(@CurrentRls() ctx: RlsContext, @Query() q: ListInvoicesQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.invoices.list(tx, q));
  }

  /** The client's UNBILLED work pool — the lines an admin bills from (Rule 3).
   *  Declared before invoices/:id so "billable" isn't matched as an id. */
  @Get("invoices/billable")
  @RequirePermission("billing", "view")
  billable(@CurrentRls() ctx: RlsContext, @Query("clientPartyId", ParseUUIDPipe) clientPartyId: string) {
    return this.db.withTenant(ctx, (tx) => this.invoices.billableLines(tx, clientPartyId));
  }

  @Get("invoices/:id")
  @RequirePermission("billing", "view")
  getInvoice(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.invoices.getInvoice(tx, id));
  }

  /** A client's AR summary (billed/collected/outstanding + open lines) for the client-360. */
  @Get("billing/client/:clientPartyId/ar")
  @RequirePermission("billing", "view")
  clientAr(@CurrentRls() ctx: RlsContext, @Param("clientPartyId", ParseUUIDPipe) clientPartyId: string) {
    return this.db.withTenant(ctx, (tx) => this.invoices.clientAr(tx, clientPartyId));
  }

  // ── payments ──
  /** The unified Cashbook — every taka in/out (payments + expenses) as one ledger. */
  @Get("cashbook")
  @RequirePermission("billing", "view")
  cashbook(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.payments.cashbook(tx));
  }

  @Post("payments")
  @RequirePermission("billing", "create")
  recordPayment(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: RecordPaymentDto) {
    return this.db.withTenant(ctx, (tx) => this.payments.recordPayment(tx, p, dto));
  }

  @Post("payments/:id/allocate")
  @RequirePermission("billing", "create")
  allocate(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AllocateDto) {
    return this.db.withTenant(ctx, (tx) => this.payments.allocate(tx, p, id, dto));
  }

  @Post("payments/:id/reverse")
  @RequirePermission("billing", "approve")
  reversePayment(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReversePaymentDto) {
    return this.db.withTenant(ctx, (tx) => this.payments.reverse(tx, p, id, dto.reason));
  }

  @Post("payments/:id/proof")
  @RequirePermission("billing", "create")
  attachProof(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AttachProofDto) {
    return this.db.withTenant(ctx, (tx) => this.payments.attachProof(tx, p, id, dto.fileObjectId, dto.side));
  }

  @Get("payments")
  @RequirePermission("billing", "view")
  listPayments(@CurrentRls() ctx: RlsContext, @Query() q: ListPaymentsQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.payments.list(tx, q));
  }

  @Get("payments/:id")
  @RequirePermission("billing", "view")
  getPayment(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.payments.getById(tx, id));
  }

  // ── charges (party→business) ──
  @Post("charges")
  @RequirePermission("billing", "create")
  createCharge(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateChargeDto) {
    return this.db.withTenant(ctx, (tx) => this.charges.createCharge(tx, p, dto));
  }

  @Post("charges/reverse")
  @RequirePermission("billing", "approve")
  reverseCharge(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: ReverseChargeDto) {
    return this.db.withTenant(ctx, (tx) => this.charges.reverseCharge(tx, p, dto));
  }

  @Get("charges")
  @RequirePermission("billing", "view")
  listCharges(@CurrentRls() ctx: RlsContext, @Query() q: ListChargesQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.charges.listCharges(tx, q.partyId));
  }

  // ── other income (business income that is NOT a client leg; 0037) ──
  @Post("other-income")
  @RequirePermission("billing", "create")
  recordOtherIncome(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateOtherIncomeDto) {
    return this.db.withTenant(ctx, (tx) => this.otherIncome.create(tx, p, dto));
  }

  @Post("other-income/reverse")
  @RequirePermission("billing", "approve")
  reverseOtherIncome(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: ReverseOtherIncomeDto) {
    return this.db.withTenant(ctx, (tx) => this.otherIncome.reverse(tx, p, dto.originalId, dto.reason));
  }

  @Get("other-income")
  @RequirePermission("billing", "view")
  listOtherIncome(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.otherIncome.list(tx));
  }

  // ── balance ──
  /** The caller's own two-way position — available to any authenticated party. */
  @Get("billing/balance/me")
  myBalance(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.balances.balance(tx, p.partyId));
  }

  @Get("billing/balance/:partyId")
  @RequirePermission("billing", "view")
  partyBalance(@CurrentRls() ctx: RlsContext, @Param("partyId", ParseUUIDPipe) partyId: string) {
    return this.db.withTenant(ctx, (tx) => this.balances.balance(tx, partyId));
  }

  /** The caller's own running-balance register (QuickBooks-style ledger). */
  @Get("billing/register/me")
  registerMe(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.balances.register(tx, p.partyId));
  }

  @Get("billing/register/:partyId")
  @RequirePermission("billing", "view")
  partyRegister(@CurrentRls() ctx: RlsContext, @Param("partyId", ParseUUIDPipe) partyId: string) {
    return this.db.withTenant(ctx, (tx) => this.balances.register(tx, partyId));
  }
}
