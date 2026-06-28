import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface Encrypted {
  iv: string; // base64, 12-byte GCM nonce
  tag: string; // base64, GCM auth tag
  ciphertext: string; // base64
}

/** Stored-string marker for a sealed value (vs. a legacy plaintext one). */
const SEAL_PREFIX = "enc:";

/**
 * AES-256-GCM field encryption (CLAUDE.md §4: secrets encrypted at rest). Used by
 * the credential vault AND the 2FA secret. The key comes from VAULT_ENCRYPTION_KEY
 * (base64 → 32 bytes), validated on FIRST cryptographic use (any seal/open that
 * needs it fails loudly). A fresh random IV per call. Never logs. Provided
 * globally (CryptoModule).
 */
@Injectable()
export class EncryptionService {
  private cachedKey: Buffer | null = null;

  /**
   * Resolve + validate the key on FIRST cryptographic use (not at construction),
   * so a deployment/test that uses neither the vault nor sealed-2FA still boots
   * without VAULT_ENCRYPTION_KEY. Any actual seal/open/encrypt/decrypt that needs
   * it fails loudly here. (open() on a legacy plaintext value needs no key.)
   */
  private key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const b64 = process.env.VAULT_ENCRYPTION_KEY;
    if (!b64) {
      throw new Error("VAULT_ENCRYPTION_KEY must be set (base64-encoded 32 bytes) for encryption at rest");
    }
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) {
      throw new Error("VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)");
    }
    this.cachedKey = key;
    return key;
  }

  encrypt(plaintext: string): Encrypted {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  decrypt(enc: Encrypted): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(enc.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }

  /**
   * Seal a single string into a self-describing token for a `text` column:
   * `enc:` + base64(JSON{iv,tag,ciphertext}). Pair with open().
   */
  seal(plaintext: string): string {
    const enc = this.encrypt(plaintext);
    return SEAL_PREFIX + Buffer.from(JSON.stringify(enc), "utf8").toString("base64");
  }

  /**
   * Open a stored value: a sealed `enc:` token → its plaintext (legacy=false); a
   * legacy plaintext value → itself (legacy=true), so callers can verify it and
   * lazily re-seal. Never throws on legacy.
   */
  open(stored: string): { plaintext: string; legacy: boolean } {
    if (!stored.startsWith(SEAL_PREFIX)) return { plaintext: stored, legacy: true };
    const enc = JSON.parse(
      Buffer.from(stored.slice(SEAL_PREFIX.length), "base64").toString("utf8"),
    ) as Encrypted;
    return { plaintext: this.decrypt(enc), legacy: false };
  }
}
