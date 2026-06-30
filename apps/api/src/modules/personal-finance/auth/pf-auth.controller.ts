import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { PfPrincipal } from "@business-os/shared";
import type { Request } from "express";
import { clientIpOf } from "../../../common/auth/client-ip.js";
import { RequestResetDto, ResetPasswordDto } from "../../../common/auth/dto.js";
import { PasswordResetService } from "../../../common/auth/password-reset.service.js";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { Public } from "../../../common/auth/public.decorator.js";
import { CurrentPfAccount } from "./current-pf-account.decorator.js";
import { PfAuthGuard } from "./pf-auth.guard.js";
import { PfAuthService } from "./pf-auth.service.js";
import { PfEnable2faDto, PfLoginDto, PfLogoutDto, PfRefreshDto, PfRegisterDto } from "./pf-auth.dto.js";

/**
 * Personal-finance auth (§11). @PfRoute() makes the global business guard yield;
 * PfAuthGuard authenticates with a PF token. login/register/refresh are @Public.
 */
@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/auth")
export class PfAuthController {
  constructor(
    private readonly auth: PfAuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Post("register")
  @HttpCode(201)
  register(@Body() dto: PfRegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.displayName, dto.baseCurrency);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: PfLoginDto) {
    return this.auth.login(dto.email, dto.password, dto.totp, dto.deviceLabel);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: PfRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Body() dto: PfLogoutDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  /** Forgot password — always returns generic {ok} (no account enumeration). */
  @Public()
  @Post("request-reset")
  @HttpCode(200)
  requestReset(@Body() dto: RequestResetDto, @Req() req: Request) {
    return this.passwordReset.request("pf", dto.email, clientIpOf(req));
  }

  @Public()
  @Post("reset")
  @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.passwordReset.reset("pf", dto.token, dto.newPassword, clientIpOf(req));
  }

  @Get("me")
  me(@CurrentPfAccount() principal: PfPrincipal) {
    return this.auth.profile(principal);
  }

  @Post("2fa/enroll")
  @HttpCode(200)
  enroll2fa(@CurrentPfAccount() principal: PfPrincipal) {
    return this.auth.enroll2fa(principal);
  }

  @Post("2fa/enable")
  @HttpCode(200)
  async enable2fa(@CurrentPfAccount() principal: PfPrincipal, @Body() dto: PfEnable2faDto) {
    await this.auth.enable2fa(principal, dto.secret, dto.code);
    return { ok: true };
  }
}
