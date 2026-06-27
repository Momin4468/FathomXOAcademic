import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { TaskController } from "./task.controller.js";
import { TaskService } from "./task.service.js";

/** Module 6 — capture-first task board (DESIGN_SPEC §8). Gated `capture:*`. */
@Module({
  imports: [AuthModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
