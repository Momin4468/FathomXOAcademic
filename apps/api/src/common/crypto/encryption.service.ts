import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface Encrypted {
  iv: string; // base64, 12-byte GCM nonce
  tag: string; // base64, GCM auth tag
  ciphertext: string; // base64
}

/**
 * AES-256-GCM field encryption for the credential vault (CLAUDE.md §4: secrets
 * encrypted at rest). The key comes from VAULT_ENCRYPTION_KEY (base64 → 32
 * bytes); the constructor HARD-FAILS at boot if it's missing/wrong-length
 * (mirrors the JWT_SECRET check). A fresh random IV per call. Never logs.
 * This provider is only instantiated when the vault module is enabled, so other
 * deployments don't need the key.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const b64 = process.env.VAULT_ENCRYPTION_KEY;
    if (!b64) {
      throw new Error("VAULT_ENCRYPTION_KEY must be set (base64-encoded 32 bytes) when the credential vault is enabled");
    }
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) {
      throw new Error("VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)");
    }
    this.key = key;
  }

  encrypt(plaintext: string): Encrypted {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  decrypt(enc: Encrypted): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(enc.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
