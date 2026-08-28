export * from "@prisma/client";
import { PrismaClient } from "@prisma/client";

export { PrismaClient };

/**
 * Server-only. Never import this package from the dashboard — it pulls in the
 * Prisma query engine, which must not reach the browser bundle.
 */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
