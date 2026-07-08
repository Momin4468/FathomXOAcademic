import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

/** A vendor submits a proposed invoice (their own party is the vendor; never from the body). */
export class SubmitVendorClaimDto {
  @IsOptional() @IsUUID() workItemId?: string; // the job it's for (optional)
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Admin decision on a vendor claim. */
export class DecideVendorClaimDto {
  @IsIn(["approved", "rejected"]) status!: "approved" | "rejected";
}
