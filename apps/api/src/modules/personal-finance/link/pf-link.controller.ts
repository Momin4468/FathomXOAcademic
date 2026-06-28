import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { PfPrincipal } from "@business-os/shared";
import { PfRoute } from "../../../common/auth/pf-route.decorator.js";
import { CurrentPfAccount } from "../auth/current-pf-account.decorator.js";
import { PfAuthGuard } from "../auth/pf-auth.guard.js";
import { PfLinkService } from "./pf-link.service.js";

export class PfConsumeLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  code!: string;
}

@PfRoute()
@UseGuards(PfAuthGuard)
@Controller("pf/link")
export class PfLinkController {
  constructor(private readonly link: PfLinkService) {}

  @Post()
  @HttpCode(200)
  consume(@CurrentPfAccount() principal: PfPrincipal, @Body() dto: PfConsumeLinkDto) {
    return this.link.consume(principal, dto.code);
  }
}
