import { Module } from "@nestjs/common";
import { DbModule } from "./common/db/db.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";

/**
 * Root module. DbModule (global access layer) + module 0 (platform) are always
 * on. Phase-1 modules 1–6 are added here behind feature flags as they're built.
 */
@Module({
  imports: [DbModule, PlatformModule],
})
export class AppModule {}
