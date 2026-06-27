import "reflect-metadata";
import "./load-env.js"; // must be first: loads .env before anything reads process.env
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate at the boundary; reject unknown fields (CLAUDE.md §4).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`Business OS API listening on http://localhost:${port}`, "Bootstrap");
}

bootstrap().catch((err) => {
  Logger.error(err, "Bootstrap");
  process.exit(1);
});
