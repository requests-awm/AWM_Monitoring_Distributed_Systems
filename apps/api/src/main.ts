import "reflect-metadata";

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

import { AppModule } from "./app.module";
import { accessTokenGate } from "./auth/access-token.middleware";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  app.set("trust proxy", 1);

  // Page loads on secondary hosts (e.g. the raw *.run.app URL) bounce to the
  // canonical domain so browsers only ever store the access token on one origin.
  // API and probe traffic is left alone — machines don't follow bookmarks.
  if (env.CANONICAL_HOST !== undefined) {
    const canonical = env.CANONICAL_HOST;
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.hostname === canonical) {
        return next();
      }
      res.redirect(301, `https://${canonical}${req.originalUrl}`);
    });
    logger.log(`Canonical host redirect enabled → ${canonical}`);
  }

  if (env.ACCESS_TOKEN !== undefined) {
    app.use(accessTokenGate(env.ACCESS_TOKEN));
    logger.log("Access-token gate enabled (X-Access-Token required on /api)");
  } else if (env.NODE_ENV === "development") {
    logger.warn("ACCESS_TOKEN not set — API is open (dev only; production refuses to start without it)");
  }

  // Serve the built dashboard when it exists (single-deployable mode): same
  // origin as the API, so the SPA's relative /api calls need no CORS.
  const dashboardDist = resolve(env.DASHBOARD_DIST ?? join(__dirname, "../../dashboard/dist"));
  const indexHtml = join(dashboardDist, "index.html");
  if (existsSync(indexHtml)) {
    app.useStaticAssets(dashboardDist);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(indexHtml);
    });
    logger.log(`Serving dashboard from ${dashboardDist}`);
  }

  await app.listen(env.PORT, "0.0.0.0");
  logger.log(`API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`);
}

void bootstrap();
