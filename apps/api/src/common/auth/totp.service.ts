import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";

/** Time-based OTP (RFC 6238) via otplib. 2FA is opt-in per user. */
@Injectable()
export class TotpService {
  /** A new base32 secret to show during enrollment. */
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /** otpauth:// URL for QR provisioning in an authenticator app. */
  keyUri(email: string, secret: string): string {
    return authenticator.keyuri(email, "FathomXO Business OS", secret);
  }

  /** Verify a 6-digit code against the secret (tolerates clock skew). */
  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  }
}
