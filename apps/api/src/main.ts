import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  new Logger("Bootstrap").log(
    `API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`,
  );
}

void bootstrap();
