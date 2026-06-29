import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import type { ClientPrincipal } from "@business-os/shared";
import { ClientRoute } from "../../../common/auth/client-route.decorator.js";
import { Public } from "../../../common/auth/public.decorator.js";
import { ClientAuthService } from "./client-auth.service.js";
import { ClientAuthGuard } from "./client-auth.guard.js";
import { CurrentClient } from "./current-client.decorator.js";
import { ClientEnable2faDto, ClientLoginDto, ClientLogoutDto, ClientRefreshDto } from "./dto.js";

/**
 * Client-portal auth (Module 18). @ClientRoute() makes the global business guard
 * yield; ClientAuthGuard authenticates with a client token. login/refresh are
 * @Public. No register — accounts are admin-provisioned (the public quotation
 * funnel is a later, separate intake).
 */
@ClientRoute()
@UseGuards(ClientAuthGuard)
@Controller("client/auth")
export class ClientAuthController {
  constructor(private readonly auth: ClientAuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: ClientLoginDto) {
    return this.auth.login(dto.loginId, dto.password, dto.totp, dto.deviceLabel);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: ClientRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Body() dto: ClientLogoutDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @Get("me")
  me(@CurrentClient() principal: ClientPrincipal) {
    return this.auth.profile(principal);
  }

  @Post("2fa/enroll")
  @HttpCode(200)
  enroll2fa(@CurrentClient() principal: ClientPrincipal) {
    return this.auth.enroll2fa(principal);
  }

  @Post("2fa/enable")
  @HttpCode(200)
  async enable2fa(@CurrentClient() principal: ClientPrincipal, @Body() dto: ClientEnable2faDto) {
    await this.auth.enable2fa(principal, dto.secret, dto.code);
    return { ok: true };
  }
}
