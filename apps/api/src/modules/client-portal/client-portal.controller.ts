import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { ClientPrincipal } from "@business-os/shared";
import { ClientRoute } from "../../common/auth/client-route.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { ClientAuthGuard } from "./auth/client-auth.guard.js";
import { CurrentClient } from "./auth/current-client.decorator.js";
import { ClientPortalService } from "./client-portal.service.js";
import { SendMessageDto, SubmitRequestDto } from "./dto.js";
import { FILES_MAX_BYTES, type UploadedFile as UploadedFileShape } from "../files/files.service.js";

/**
 * The client-facing portal (Module 18). @ClientRoute() + ClientAuthGuard — only a
 * client token reaches here. Every handler runs under the business RLS context
 * scoped to the client's OWN party; reads are caller-guarded definers and writes
 * force the party from the token.
 */
@ClientRoute()
@UseGuards(ClientAuthGuard)
@Controller("client")
export class ClientPortalController {
  constructor(
    private readonly db: DbService,
    private readonly portal: ClientPortalService,
  ) {}

  private ctx(p: ClientPrincipal) {
    return { orgId: p.orgId, partyId: p.partyId, isSuperadmin: false };
  }

  @Get("config")
  config() {
    return this.portal.config();
  }

  @Get("works")
  works(@CurrentClient() p: ClientPrincipal) {
    return this.db.withTenant(this.ctx(p), (tx) => this.portal.works(tx, p));
  }

  @Get("summary")
  summary(@CurrentClient() p: ClientPrincipal) {
    return this.db.withTenant(this.ctx(p), (tx) => this.portal.summary(tx, p));
  }

  @Get("messages")
  messages(@CurrentClient() p: ClientPrincipal) {
    return this.db.withTenant(this.ctx(p), (tx) => this.portal.listMessages(tx, p));
  }

  @Post("messages")
  @HttpCode(201)
  sendMessage(@CurrentClient() p: ClientPrincipal, @Body() dto: SendMessageDto) {
    return this.db.withTenant(this.ctx(p), (tx) => this.portal.sendMessage(tx, p, dto.body));
  }

  @Post("requests")
  @HttpCode(201)
  submitRequest(@CurrentClient() p: ClientPrincipal, @Body() dto: SubmitRequestDto) {
    return this.db.withTenant(this.ctx(p), (tx) => this.portal.submitRequest(tx, p, dto));
  }

  @Post("requests/:id/brief")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILES_MAX_BYTES } }))
  attachBrief(
    @CurrentClient() p: ClientPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileShape | undefined,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.db.withTenant(this.ctx(p), (tx) => this.portal.attachBrief(tx, p, id, file));
  }
}
