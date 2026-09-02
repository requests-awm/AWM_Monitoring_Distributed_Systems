import { connect as netConnect } from "node:net";
import { connect as tlsConnect, type PeerCertificate, type TLSSocket } from "node:tls";

import type {
  ApiIntegrationMonitorConfig,
  EmailProviderMonitorConfig,
  HttpMonitorConfig,
  MonitorJob,
  MonitorResultReport,
  SslMonitorConfig,
  TcpMonitorConfig,
} from "@awm/shared";

export type CheckOutcome = Omit<MonitorResultReport, "monitorId">;

/** Executes one due check. Never throws — failures become failure results. */
export async function executeJob(job: MonitorJob): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    switch (job.monitorType) {
      case "http":
        return await runHttp(job.configuration as HttpMonitorConfig, job.timeoutMs, false);
      case "api_integration":
        return await runHttp(job.configuration as ApiIntegrationMonitorConfig, job.timeoutMs, true);
      case "tcp_port":
        return await runTcp(job.configuration as TcpMonitorConfig, job.timeoutMs);
      case "ssl":
        return await runSsl(job.configuration as SslMonitorConfig, job.timeoutMs);
      case "email_provider":
        return await runSmtp(job.configuration as EmailProviderMonitorConfig, job.timeoutMs);
      default:
        return failure(started, `Executor for ${job.monitorType} not implemented`);
    }
  } catch (error) {
    return failure(started, error instanceof Error ? error.message : String(error));
  }
}

function now(): string {
  return new Date().toISOString();
}

function failure(started: number, reason: string, statusCode: number | null = null): CheckOutcome {
  return {
    status: "failure",
    success: false,
    responseTimeMs: Date.now() - started,
    statusCode,
    failureReason: reason.slice(0, 1900),
    metadata: null,
    checkedAt: now(),
  };
}

// --- HTTP / integration ------------------------------------------------------

async function runHttp(
  config: HttpMonitorConfig & { service?: string },
  timeoutMs: number,
  classify: boolean,
): Promise<CheckOutcome> {
  const started = Date.now();
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  const auth = config.auth;
  if (auth !== undefined) {
    if (auth.type === "basic" && auth.username !== undefined) {
      headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password ?? ""}`).toString("base64")}`;
    } else if (auth.type === "bearer" && auth.token !== undefined) {
      headers.authorization = `Bearer ${auth.token}`;
    } else if (auth.type === "api_key" && auth.headerName !== undefined) {
      headers[auth.headerName] = auth.headerValue ?? auth.token ?? "";
    } else if (auth.type === "custom_headers" && auth.headerName !== undefined) {
      headers[auth.headerName] = auth.headerValue ?? "";
    }
  }

  let res: Response;
  try {
    res = await fetch(config.url, {
      method: config.method.toUpperCase(),
      headers,
      body: config.method === "get" || config.method === "head" ? undefined : config.body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    if (message.includes("Timeout") || message.includes("timeout")) {
      return failure(started, `Timeout after ${timeoutMs}ms`);
    }
    return failure(started, cause !== undefined ? `${cause}: ${message}` : message);
  }
  const durationMs = Date.now() - started;
  const bodyText = await res.text().catch(() => "");
  const service = classify ? (config.service ?? "integration") : null;
  const rateLimit = parseRateLimit(res.headers);
  const metadata: Record<string, unknown> | null =
    service !== null || rateLimit !== null
      ? { ...(service !== null ? { service } : {}), ...(rateLimit !== null ? { rateLimit } : {}) }
      : null;

  const problems: string[] = [];
  const v = config.validation;
  const expected = v?.expectedStatusCodes ?? [];
  const statusOk = expected.length > 0 ? expected.includes(res.status) : res.ok;
  if (!statusOk) {
    if (classify && (res.status === 401 || res.status === 403)) {
      problems.push(`${service ?? ""} ${res.status === 401 ? "authentication" : "permission"} failure (HTTP ${res.status})`.trim());
    } else if (classify && res.status === 429) {
      problems.push(`${service ?? ""} rate limited (HTTP 429)`.trim());
    } else {
      problems.push(`Unexpected status ${res.status}`);
    }
  }
  if (v?.keyword !== undefined && !bodyText.includes(v.keyword)) {
    problems.push(`Expected keyword "${v.keyword}" not found`);
  }
  if (v?.forbiddenKeyword !== undefined && bodyText.includes(v.forbiddenKeyword)) {
    problems.push(`Forbidden keyword "${v.forbiddenKeyword}" present`);
  }
  if (v?.jsonFieldPath !== undefined) {
    const value = jsonPath(bodyText, v.jsonFieldPath);
    if (value === undefined) {
      problems.push(`JSON field "${v.jsonFieldPath}" missing`);
    } else if (v.jsonFieldEquals !== undefined && String(value) !== v.jsonFieldEquals) {
      problems.push(`JSON field "${v.jsonFieldPath}" is "${String(value)}", expected "${v.jsonFieldEquals}"`);
    }
  }

  if (problems.length > 0) {
    return {
      status: "failure",
      success: false,
      responseTimeMs: durationMs,
      statusCode: res.status,
      failureReason: problems.join("; ").slice(0, 1900),
      metadata,
      checkedAt: now(),
    };
  }
  if (v?.maxDurationMs !== undefined && durationMs > v.maxDurationMs) {
    return {
      status: "degraded",
      success: true,
      responseTimeMs: durationMs,
      statusCode: res.status,
      failureReason: `Response ${durationMs}ms exceeded threshold ${v.maxDurationMs}ms`,
      metadata,
      checkedAt: now(),
    };
  }
  const quotaWarnPct = classify ? ((config as { quotaWarnPct?: number }).quotaWarnPct ?? 20) : null;
  if (quotaWarnPct !== null && rateLimit !== null && rateLimit.remainingPct <= quotaWarnPct) {
    return {
      status: "degraded",
      success: true,
      responseTimeMs: durationMs,
      statusCode: res.status,
      failureReason: `Provider quota low: ${rateLimit.remaining}/${rateLimit.limit} requests remaining (${rateLimit.remainingPct}%)`,
      metadata,
      checkedAt: now(),
    };
  }
  return {
    status: "success",
    success: true,
    responseTimeMs: durationMs,
    statusCode: res.status,
    failureReason: null,
    metadata,
    checkedAt: now(),
  };
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  remainingPct: number;
  resetAt: string | null;
}

/**
 * Providers report quota differently: plain x-ratelimit-* (Insightly, GitHub),
 * suffixed -requests/-tokens (OpenAI). Requests-quota wins when both exist.
 */
function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const num = (...names: string[]): number | null => {
    for (const name of names) {
      const v = headers.get(name);
      if (v !== null && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };
  const limit = num("x-ratelimit-limit", "x-ratelimit-limit-requests", "ratelimit-limit");
  const remaining = num("x-ratelimit-remaining", "x-ratelimit-remaining-requests", "ratelimit-remaining");
  if (limit === null || remaining === null || limit <= 0) return null;
  const reset = headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset");
  let resetAt: string | null = null;
  if (reset !== null && Number.isFinite(Number(reset))) {
    const n = Number(reset);
    // epoch seconds vs delta seconds — epochs are huge.
    resetAt = new Date(n > 10_000_000 ? n * 1000 : Date.now() + n * 1000).toISOString();
  }
  return { limit, remaining, remainingPct: Math.round((remaining / limit) * 1000) / 10, resetAt };
}

function jsonPath(bodyText: string, path: string): unknown {
  try {
    let value: unknown = JSON.parse(bodyText);
    for (const key of path.split(".")) {
      if (value === null || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  } catch {
    return undefined;
  }
}

// --- TCP ---------------------------------------------------------------------

function runTcp(config: TcpMonitorConfig, timeoutMs: number): Promise<CheckOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = netConnect({ host: config.host, port: config.port });
    const done = (outcome: CheckOutcome): void => {
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(timeoutMs, () => done(failure(started, `Timeout after ${timeoutMs}ms connecting to ${config.host}:${config.port}`)));
    socket.on("connect", () =>
      done({
        status: "success",
        success: true,
        responseTimeMs: Date.now() - started,
        statusCode: null,
        failureReason: null,
        metadata: null,
        checkedAt: now(),
      }),
    );
    socket.on("error", (error: NodeJS.ErrnoException) =>
      done(failure(started, `${error.code ?? "ERROR"}: ${error.message}`)),
    );
  });
}

// --- SSL ---------------------------------------------------------------------

function runSsl(config: SslMonitorConfig, timeoutMs: number): Promise<CheckOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    let socket: TLSSocket;
    const done = (outcome: CheckOutcome): void => {
      socket.destroy();
      resolve(outcome);
    };
    socket = tlsConnect(
      { host: config.host, port: config.port, servername: config.host, rejectUnauthorized: false },
      () => {
        const cert: PeerCertificate = socket.getPeerCertificate();
        const durationMs = Date.now() - started;
        if (cert.valid_to === undefined) {
          done(failure(started, "No certificate presented"));
          return;
        }
        const validTo = new Date(cert.valid_to).getTime();
        const daysRemaining = Math.floor((validTo - Date.now()) / 86_400_000);
        const authorized = socket.authorized;
        const metadata = {
          daysRemaining,
          issuer: cert.issuer?.O ?? cert.issuer?.CN ?? "unknown",
          validTo: new Date(validTo).toISOString(),
          subject: cert.subject?.CN ?? config.host,
        };
        if (daysRemaining < 0) {
          done({ status: "failure", success: false, responseTimeMs: durationMs, statusCode: null, failureReason: `Certificate expired ${-daysRemaining}d ago`, metadata, checkedAt: now() });
          return;
        }
        if (!authorized) {
          done({ status: "failure", success: false, responseTimeMs: durationMs, statusCode: null, failureReason: `Certificate not trusted: ${socket.authorizationError?.toString() ?? "unknown"}`, metadata, checkedAt: now() });
          return;
        }
        const crossed = [...config.warnDays].sort((a, b) => a - b).find((d) => daysRemaining <= d);
        if (crossed !== undefined) {
          done({ status: "degraded", success: true, responseTimeMs: durationMs, statusCode: null, failureReason: `Certificate expires in ${daysRemaining}d (threshold ${crossed}d)`, metadata, checkedAt: now() });
          return;
        }
        done({ status: "success", success: true, responseTimeMs: durationMs, statusCode: null, failureReason: null, metadata, checkedAt: now() });
      },
    );
    socket.setTimeout(timeoutMs, () => done(failure(started, `TLS timeout after ${timeoutMs}ms`)));
    socket.on("error", (error: NodeJS.ErrnoException) =>
      done(failure(started, `TLS ${error.code ?? "ERROR"}: ${error.message}`)),
    );
  });
}

// --- SMTP (email provider connectivity) ---------------------------------------

function runSmtp(config: EmailProviderMonitorConfig, timeoutMs: number): Promise<CheckOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = config.secure
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
      : netConnect({ host: config.host, port: config.port });
    let settled = false;
    const done = (outcome: CheckOutcome): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(timeoutMs, () => done(failure(started, `SMTP timeout after ${timeoutMs}ms`)));
    socket.on("data", (chunk: Buffer) => {
      const banner = chunk.toString("utf8");
      if (banner.startsWith("220")) {
        done({
          status: "success",
          success: true,
          responseTimeMs: Date.now() - started,
          statusCode: null,
          failureReason: null,
          metadata: { banner: banner.slice(0, 120).trim() },
          checkedAt: now(),
        });
      } else {
        done(failure(started, `Unexpected SMTP banner: ${banner.slice(0, 120).trim()}`));
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) =>
      done(failure(started, `SMTP ${error.code ?? "ERROR"}: ${error.message}`)),
    );
  });
}
