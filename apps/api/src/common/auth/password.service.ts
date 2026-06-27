import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";

/** Password hashing (bcryptjs — pure-JS, portable). */
@Injectable()
export class PasswordService {
  private readonly rounds = 12;

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
