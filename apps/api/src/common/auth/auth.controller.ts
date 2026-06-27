import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import type { SessionPrincipal } from "@business-os/shared";
import { AuthService } from "./auth.service.js";
import { CurrentPrincipal } from "./current-principal.decorator.js";
import { Enable2faDto, LoginDto, LogoutDto, RefreshDto } from "./dto.js";
import { Public } from "./public.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.totp, dto.deviceLabel);
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
