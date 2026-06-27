import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller.js";

/**
 * Module 0 — Platform / tenancy / access. Today: health + whoami (proves the
 * RLS access layer). Grows into the permission engine, audit, and provenance.
 * Always on (the spine); other modules are feature-flagged.
 */
@Module({
  controllers: [PlatformController],
})
export class PlatformModule {}
