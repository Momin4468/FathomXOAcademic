import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { TASK_STATES, type TaskState } from "@business-os/shared";

export class CreateTaskDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) details?: string;
  @IsOptional() @IsUUID() assigneePartyId?: string;
  @IsOptional() @IsUUID() assigneeUserId?: string;
  @IsOptional() @IsUUID() workItemId?: string;

  // Deadline: either a precomputed absolute instant + zone, OR wall date+time+zone.
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) dueTime?: string;
  @IsOptional() @IsString() @MaxLength(64) dueTz?: string; // IANA zone
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) details?: string;
  @IsOptional() @IsIn(TASK_STATES) state?: TaskState;
  @IsOptional() @IsUUID() assigneePartyId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) dueTime?: string;
  @IsOptional() @IsString() @MaxLength(64) dueTz?: string;
}

export class ListTasksQueryDto {
  @IsOptional() @IsString() mine?: string; // "true" → only the caller's tasks
  @IsOptional() @IsIn(TASK_STATES) state?: TaskState;
}
