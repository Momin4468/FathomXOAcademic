import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../../common/auth/auth.module.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { ClientAuthController } from "./auth/client-auth.controller.js";
import { ClientAuthGuard } from "./auth/client-auth.guard.js";
import { ClientAuthService } from "./auth/client-auth.service.js";
import { ClientTokenService } from "./auth/client-token.service.js";
import { ClientAdminController } from "./client-admin.controller.js";
import { ClientAdminService } from "./client-admin.service.js";
import { ClientPortalController } from "./client-portal.controller.js";
import { ClientPortalService } from "./client-portal.service.js";
import { PublicIntakeController } from "./public-intake.controller.js";
import { PublicIntakeService } from "./public-intake.service.js";

/**
 * Module 18 — the CLIENT portal: a third scoped login plane (DESIGN_SPEC §4.1).
 * The client plane (ClientAuthGuard + @ClientRoute) exposes a scoped, redacted
 * view of a client's own jobs/AR + a draft-intake + a message thread; the
 * admin-side (ClientAdminController, business-plane, `client_portal`-gated)
 * provisions logins, replies to messages, and purges expired leads. Reuses
 * PasswordService/TotpService (AuthModule) + EncryptionService/AuditService/
 * DbService (global); its own JwtModule signs distinct-typ client tokens. Gated
 * `FEATURE_CLIENT_PORTAL`.
 */
@Module({
  imports: [
    AuthModule, // PasswordService, TotpService
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) {
          throw new Error("JWT_SECRET must be set and at least 32 characters");
        }
        return {
          secret,
          signOptions: { algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
    }),
  ],
  controllers: [
    ClientAuthController,
    ClientPortalController,
    ClientAdminController,
    PublicIntakeController,
  ],
  providers: [
    ClientTokenService,
    ClientAuthGuard,
    ClientAuthService,
    ClientPortalService,
    ClientAdminService,
    PublicIntakeService,
    StorageService,
  ],
})
export class ClientPortalModule {}
