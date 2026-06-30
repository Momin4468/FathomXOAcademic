import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PermissionService } from "../authz/permission.service.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { PasswordResetService } from "./password-reset.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { TotpService } from "./totp.service.js";

/**
 * Module 0 auth + authz. Registers the two global guards in order: AuthGuard
 * (establish identity from the signed token) THEN PermissionGuard (enforce
 * roles-as-data on @RequirePermission handlers).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        // Fail fast: a missing/weak secret would let anyone forge an access token
        // (incl. sysadmin + arbitrary org/party), defeating the whole module.
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) {
          throw new Error("JWT_SECRET must be set and at least 32 characters");
        }
        return {
          secret,
          // Pin the algorithm so a token can't claim 'none'/asymmetric.
          signOptions: { algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TotpService,
    TokenService,
    PermissionService,
    AuthService,
    PasswordResetService,
    // Global guards — order matters (auth before authz).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, TokenService, PermissionService, PasswordService, TotpService, PasswordResetService],
})
export class AuthModule {}
