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
import {
  CreateCustomFieldDto,
  ListCustomFieldQueryDto,
  SearchCustomFieldQueryDto,
  UpdateCustomFieldDto,
} from "./dto.js";
import { CustomFieldService } from "./custom-field.service.js";

/**
 * Module 12 — custom fields (§2 #10, §8). DEFINING fields is governed
 * (custom_fields:approve); VIEWING the catalog + searching is custom_fields:view
 * (operational roles render/fill/verify). Filling values rides each record's own
 * edit permission (validated server-side against this catalog).
 */
@Controller("custom-fields")
export class CustomFieldController {
  constructor(
    private readonly db: DbService,
    private readonly fields: CustomFieldService,
  ) {}

  @Get()
  @RequirePermission("custom_fields", "view")
  list(@CurrentRls() ctx: RlsContext, @Query() q: ListCustomFieldQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.fields.listDefs(tx, q));
  }

  /** Find records by a custom field value (the "verify later" flow). */
  @Get("search")
  @RequirePermission("custom_fields", "view")
  search(@CurrentRls() ctx: RlsContext, @Query() q: SearchCustomFieldQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.fields.search(tx, q));
  }

  @Post()
  @RequirePermission("custom_fields", "approve")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateCustomFieldDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.fields.createDef(tx, principal, dto));
  }

  @Patch(":id")
  @RequirePermission("custom_fields", "approve")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomFieldDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.fields.updateDef(tx, principal, id, dto));
  }

  @Post(":id/archive")
  @RequirePermission("custom_fields", "approve")
  archive(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.fields.archiveDef(tx, principal, id));
  }
}
