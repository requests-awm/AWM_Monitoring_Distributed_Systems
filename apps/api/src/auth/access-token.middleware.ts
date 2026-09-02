import { timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { sha256Hex } from "../lib/secrets";

/**
 * Interim access gate until Supabase Auth (M1): every /api route must carry
 * `X-Access-Token: <ACCESS_TOKEN>` except routes that already authenticate
 * themselves (ingest bearer tokens, heartbeat URL tokens, worker shared
 * secret) and the health probes. Static SPA assets stay public — the app
 * shell is harmless without data, and the dashboard needs to load in order
 * to prompt for the token.
 */
// /api/status is deliberately public: names + up/down only, no configuration.
const OPEN_PREFIXES = ["/api/health", "/api/ingest/", "/api/heartbeats/", "/api/internal/", "/api/status"];

export function accessTokenGate(accessToken: string): (req: Request, res: Response, next: NextFunction) => void {
  // Compare digests, not raw strings: constant length makes timingSafeEqual usable.
  const expected = Buffer.from(sha256Hex(accessToken), "hex");
  return (req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    if (OPEN_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
    const header = req.headers["x-access-token"];
    if (typeof header === "string" && timingSafeEqual(expected, Buffer.from(sha256Hex(header), "hex"))) {
      return next();
    }
    res.status(401).json({ message: "Missing or invalid access token" });
  };
}
