import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Public "Get a Quote" submission (unauthenticated). All fields arrive as
 * multipart text (the brief is a separate file part). `website` is a HONEYPOT —
 * a hidden field real users leave empty; a filled value is treated as a bot and
 * silently no-ops. Validated at the boundary (global ValidationPipe whitelists).
 */
export class PublicQuoteDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsEmail() @MaxLength(160) email!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string; // WhatsApp / phone
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(160) service?: string; // service type
  @IsOptional() @IsString() @MaxLength(80) level?: string; // academic level
  @IsOptional() @IsString() @MaxLength(80) deadline?: string;
  @IsOptional() @IsString() @MaxLength(40) wordCount?: string;
  @IsString() @MinLength(1) @MaxLength(5000) details!: string;
  /** Honeypot — must stay empty. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}
