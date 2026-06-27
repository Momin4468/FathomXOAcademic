import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { CreatePartyDto, ListPartyQueryDto, UpdatePartyDto } from "./dto.js";
import { PartyService } from "./party.service.js";

/** Party / client directory (DESIGN_SPEC §7). Gated by `reference` permissions. */
@Controller("parties")
export class PartyController {
  constructor(
    private readonly db: DbService,
    private readonly parties: PartyService,
  ) {}

  @Get()
  @RequirePermission("reference", "view")
  list(@CurrentRls() ctx: RlsContext, @Query() query: ListPartyQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.parties.search(tx, query.q, query.type));
  }

  @Get(":id")
  @RequirePermission("reference", "view")
  getById(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.parties.getById(tx, id));
  }

  @Post()
  @RequirePermission("reference", "create")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreatePartyDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.parties.create(tx, principal, dto));
  }

  @Patch(":id")
  @RequirePermission("reference", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.parties.update(tx, principal, id, dto));
  }
}
