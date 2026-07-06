import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { SessionPrincipal } from "@business-os/shared";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";
import { CurrentPrincipal } from "./current-principal.decorator.js";
import { Enable2faDto, LoginDto, LogoutDto, RefreshDto, RequestResetDto, ResetPasswordDto } from "./dto.js";
import { clientIpOf } from "./client-ip.js";
import { PasswordResetService } from "./password-reset.service.js";
import { Public } from "./public.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, dto.totp, dto.deviceLabel, clientIpOf(req));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Body() dto: LogoutDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  /** Forgot password — always returns generic {ok} (no account enumeration). */
  @Public()
  @Post("request-reset")
  @HttpCode(200)
  requestReset(@Body() dto: RequestResetDto, @Req() req: Request) {
    return this.passwordReset.request("business", dto.email, clientIpOf(req));
  }

  /** Set a new password using an emailed token. */
  @Public()
  @Post("reset")
  @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.passwordReset.reset("business", dto.token, dto.newPassword, clientIpOf(req));
  }

  /** The authenticated identity (from the signed token). */
  @Get("me")
  me(@CurrentPrincipal() principal: SessionPrincipal) {
    return { principal };
  }

  @Post("2fa/enroll")
  @HttpCode(200)
  enroll2fa(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.auth.enroll2fa(principal);
  }

  @Post("2fa/enable")
  @HttpCode(200)
  async enable2fa(@CurrentPrincipal() principal: SessionPrincipal, @Body() dto: Enable2faDto) {
    await this.auth.enable2fa(principal, dto.secret, dto.code);
    return { ok: true };
  }
}
