import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "./encryption.service.js";

/**
 * Global AES-256-GCM encryption (CLAUDE.md §4). Provided once and exported
 * everywhere — the credential vault AND 2FA-secret-at-rest depend on it.
 * VAULT_ENCRYPTION_KEY is validated on first cryptographic use (so a key-less
 * deployment that touches neither still boots), and fails loudly when actually
 * sealing/opening a secret.
 */
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
