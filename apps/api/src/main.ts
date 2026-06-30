import "reflect-metadata";
import "./load-env.js"; // must be first: loads .env before anything reads process.env
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind a hosting proxy (e.g. Render), trust the first hop so req.ip and
  // X-Forwarded-For reflect the real client — the rate-limiters key on it.
  app.set("trust proxy", 1);

  // Standard security headers (CSP defaults, HSTS, etc.). This is a JSON API
  // behind a BFF, so the conservative defaults are appropriate.
  app.use(helmet());

  // Validate at the boundary; reject unknown fields (CLAUDE.md §4).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Graceful shutdown on SIGTERM/SIGINT (Render deploys/restarts) so onModuleDestroy
  // hooks run — closes the pg pool cleanly instead of dropping in-flight work.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  // Bind 0.0.0.0 (not localhost) so the platform's proxy can reach the process.
  await app.listen(port, "0.0.0.0");
  Logger.log(`Business OS API listening on port ${port}`, "Bootstrap");
}

bootstrap().catch((err) => {
  Logger.error(err, "Bootstrap");
  process.exit(1);
});
