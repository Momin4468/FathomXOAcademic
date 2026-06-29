import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { Public } from "../../common/auth/public.decorator.js";
import { FILES_MAX_BYTES, type UploadedFile as UploadedFileShape } from "../files/files.service.js";
import { PublicQuoteDto } from "./public-intake.dto.js";
import { PublicIntakeService } from "./public-intake.service.js";

/**
 * The PUBLIC quote intake (the marketing-site lead funnel). @Public — no auth.
 * Reached server-to-server from the marketing app's BFF (the API stays private,
 * no CORS). Creates a lead + a DRAFT only; returns nothing internal.
 */
@Public()
@Controller("public")
export class PublicIntakeController {
  constructor(private readonly intake: PublicIntakeService) {}

  @Post("quote")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILES_MAX_BYTES } }))
  submit(
    @Body() dto: PublicQuoteDto,
    @UploadedFile() file: UploadedFileShape | undefined,
    @Req() req: Request,
  ) {
    // Trust the forwarded client IP ONLY from the marketing BFF (it sends a shared
    // secret header when configured) — otherwise a direct caller could spoof a
    // fresh X-Forwarded-For per request to evade the per-IP limit. With no secret
    // configured (dev/test) we trust XFF as before. Fall back to the socket IP.
    const proxySecret = process.env.PUBLIC_INTAKE_PROXY_SECRET;
    const trusted = !proxySecret || req.headers["x-intake-proxy"] === proxySecret;
    const fwd = req.headers["x-forwarded-for"];
    const xff = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    const ip = (trusted && xff) || req.ip || "unknown";
    return this.intake.submitQuote(dto, file, ip);
  }
}
