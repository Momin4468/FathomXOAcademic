import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { KnowledgeController } from "./knowledge.controller.js";
import { KnowledgeService } from "./knowledge.service.js";

/**
 * Module 9 — knowledge base (docs/prompt-packs/blogs, open authoring) +
 * cover-sheet templates (§7/§8). Media uses the file pipeline (FilesModule).
 * Gated by the `knowledge` permission module; registered under FEATURE_KNOWLEDGE.
 */
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
