import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { CredentialVaultController } from "./credential-vault.controller.js";
import { CredentialVaultService } from "./credential-vault.service.js";

/**
 * Module 8 — credential vault (DESIGN_SPEC §8, CLAUDE.md §4): encrypted tool/
 * portal credentials with per-item sharing + 2FA-gated reveal. Gated by the
 * `credential_vault` permission module, registered under FEATURE_CREDENTIAL_VAULT.
 * EncryptionService comes from the global CryptoModule (also used by 2FA-at-rest).
 * AuthModule supplies TotpService (the step-up).
 */
@Module({
  imports: [AuthModule],
  controllers: [CredentialVaultController],
  providers: [CredentialVaultService],
})
export class CredentialVaultModule {}
