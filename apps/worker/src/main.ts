import "reflect-metadata";

import { createServer, type Server } from "node:http";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { env } from "./config/env";
import { WorkerModule } from "./worker.module";

// The worker is a headless application context; containers and host platforms
// still need something to probe, so expose a bare liveness endpoint.
// PORT (injected by Cloud Run/Heroku-style hosts) wins over WORKER_PORT — but
// only in production: in local dev the shared .env sets PORT for the API, and
// honoring it here would make the worker steal the API's port.
const healthPort =
  env.NODE_ENV === "production" && Number(process.env.PORT ?? "") > 0
    ? Number(process.env.PORT)
    : env.WORKER_PORT;

function startHealthServer(logger: Logger): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", service: "worker", timestamp: new Date().toISOString() }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(healthPort, "0.0.0.0", () => {
    logger.log(`Health endpoint on http://localhost:${healthPort}/health`);
  });
  return server;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger("Worker");
  logger.log(`Monitoring worker started (${env.NODE_ENV})`);
  const healthServer = startHealthServer(logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down`);
    healthServer.close();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap();
