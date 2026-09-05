import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { $Enums, Prisma, PrismaClient } from "@awm/db";

import { env, isLiveMode } from "../config/env";
import { decryptSecret, encryptSecret } from "../lib/secrets";
import {
  MonitoringStore,
  type AlertRuleRecord,
  type ChannelRecord,
  type IncidentRecord,
  type MaintenanceWindowRecord,
  type MonitorRecord,
  type MonitorResultRecord,
  type ProjectRecord,
} from "./monitoring.store";

/**
 * Live-mode persistence for the monitoring core (the CONTINUATION.md seam).
 *
 * The in-memory MonitoringStore stays the hot working set — services and the
 * incident engine are unchanged consumers. This layer adds two things in live
 * mode (DATABASE_URL set):
 *
 *  - boot hydration: the store is rebuilt from the DB (or, on a first boot
 *    against an empty schema, the seeded defaults are materialized into it),
 *    so monitors, channels, rules, windows, open incidents, recent results,
 *    and heartbeat tokens survive restarts and redeploys;
 *  - write-through: every mutation is upserted to the DB fire-and-forget on a
 *    serialized queue — a DB hiccup degrades durability, never a request.
 *
 * Sample mode: every method is a no-op.
 *
 * Not persisted (by design, for now): scheduler runtime (nextDueAt,
 * consecutiveFails), the in-memory audit trail, escalation timers.
 */

const RESULT_HYDRATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESULT_HYDRATE_CAP = 5000;
const INCIDENT_HYDRATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const KNOWN_EVENT_TYPES = new Set([
  "created",
  "acknowledged",
  "note_added",
  "assigned",
  "escalated",
  "notified",
  "resolved",
  "reopened",
  "muted",
]);

@Injectable()
export class MonitoringPersistence implements OnModuleInit {
  private readonly logger = new Logger(MonitoringPersistence.name);
  private prisma: PrismaClient | null = null;
  private orgId: string | null = null;
  // Writes are serialized so two upserts of the same row can never race.
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly store: MonitoringStore) {}

  async onModuleInit(): Promise<void> {
    if (!isLiveMode) return;
    try {
      // Lazy import keeps the Prisma engine out of sample-mode processes.
      const { createPrismaClient } = await import("@awm/db");
      this.prisma = createPrismaClient();
      await this.hydrate();
    } catch (error) {
      this.logger.error(
        `monitoring persistence hydration failed — serving in-memory seeds; write-through stays on`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  // --- hydration ---------------------------------------------------------

  private async hydrate(): Promise<void> {
    const prisma = this.prisma as PrismaClient;
    const org = await prisma.organisation.findFirst({ where: { isDeleted: false } });
    if (org === null) {
      this.logger.warn(`no organisation row — monitoring core stays in-memory (seed one, see docs)`);
      return;
    }
    this.orgId = org.id;

    // Deleted rows count too: their presence means a prior boot materialized.
    const monitorsInDb = await prisma.monitor.count();
    if (monitorsInDb === 0) {
      // Only a production boot may materialize: local dev seeds carry
      // localhost URLs (SELF_BASE_URL unset) that must never become the
      // shared baseline. Dev live-mode keeps its in-memory seeds; anything
      // created through the API still writes through.
      if (env.NODE_ENV !== "production") {
        this.logger.warn(
          `DB has no monitors — seeds stay in-memory (only a production boot materializes them)`,
        );
        return;
      }
      await this.materializeSeeds();
      return;
    }

    const resultsSince = new Date(Date.now() - RESULT_HYDRATE_WINDOW_MS);
    const incidentsSince = new Date(Date.now() - INCIDENT_HYDRATE_WINDOW_MS);
    const [projects, monitors, channels, rules, windows, incidents, results] = await Promise.all([
      prisma.project.findMany({ include: { environments: true } }),
      prisma.monitor.findMany(),
      prisma.notificationChannel.findMany(),
      prisma.alertRule.findMany(),
      prisma.maintenanceWindow.findMany(),
      prisma.incident.findMany({
        where: {
          isDeleted: false,
          OR: [{ status: { notIn: ["resolved", "muted"] } }, { startedAt: { gte: incidentsSince } }],
        },
        include: { events: { orderBy: { createdAt: "asc" } } },
      }),
      prisma.monitorResult.findMany({
        where: { checkedAt: { gte: resultsSince } },
        orderBy: { checkedAt: "desc" },
        take: RESULT_HYDRATE_CAP,
      }),
    ]);

    this.store.projects.length = 0;
    for (const p of projects) {
      this.store.projects.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        environments: p.environments
          .filter((e) => !e.isDeleted)
          .map((e) => ({ id: e.id, name: e.name })),
        isDeleted: p.isDeleted,
      });
    }

    const latestResultAt = new Map<string, number>();
    for (const r of results) {
      const t = r.checkedAt.getTime();
      const cur = latestResultAt.get(r.monitorId);
      if (cur === undefined || t > cur) latestResultAt.set(r.monitorId, t);
    }

    this.store.monitors.clear();
    const bootAt = Date.now();
    for (const m of monitors) {
      this.store.monitors.set(m.id, {
        id: m.id,
        name: m.name,
        description: m.description,
        projectId: m.projectId,
        environmentId: m.environmentId,
        monitorType: m.monitorType,
        checkIntervalMinutes: m.checkIntervalMinutes,
        timeoutMs: m.timeoutMs,
        retryCount: m.retryCount,
        severity: m.severity,
        tags: m.tags,
        enabled: m.enabled,
        configuration: (m.configuration ?? {}) as Record<string, unknown>,
        heartbeatToken: m.heartbeatToken,
        createdAt: m.createdAt.toISOString(),
        isDeleted: m.isDeleted,
        nextDueAt: bootAt,
        consecutiveFails: 0,
        // Missed-job baseline: the last known result, else boot time — one
        // expected-interval grace after a deploy instead of an instant alert.
        lastHeartbeatAt:
          m.monitorType === "heartbeat" ? (latestResultAt.get(m.id) ?? bootAt) : null,
        lastMissedEmitAt: null,
      });
    }

    this.store.channels.length = 0;
    for (const c of channels) {
      this.store.channels.push({
        id: c.id,
        name: c.name,
        channelType: c.channelType,
        config: this.decodeChannelConfig(c.config, c.name),
        enabled: c.enabled,
        isDeleted: c.isDeleted,
      });
    }

    this.store.alertRules.length = 0;
    for (const r of rules) {
      this.store.alertRules.push({
        id: r.id,
        name: r.name,
        channelId: r.channelId,
        conditions: (r.conditions ?? {}) as AlertRuleRecord["conditions"],
        escalationDelaySeconds: r.escalationDelaySeconds,
        priority: r.priority,
        enabled: r.enabled,
        isDeleted: r.isDeleted,
      });
    }

    this.store.maintenanceWindows.length = 0;
    for (const w of windows) {
      this.store.maintenanceWindows.push({
        id: w.id,
        name: w.name,
        scope: w.scope,
        projectId: w.projectId,
        environmentId: w.environmentId,
        monitorId: w.monitorId,
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
        muteExisting: w.muteExisting,
        isDeleted: w.isDeleted,
      });
    }

    this.store.incidents.clear();
    for (const i of incidents) {
      const events = i.events.map((e) => ({
        id: e.id,
        eventType: e.eventType as string,
        message: e.message,
        actor: actorFromMetadata(e.metadata),
        createdAt: e.createdAt.toISOString(),
      }));
      const lastAssigned = [...events].reverse().find((e) => e.eventType === "assigned");
      this.store.incidents.set(i.id, {
        id: i.id,
        monitorId: i.monitorId,
        status: i.status,
        severity: i.severity,
        title: i.title,
        summary: i.summary,
        failureReason: i.failureReason,
        dedupSignature: i.dedupSignature,
        occurrenceCount: i.occurrenceCount,
        startedAt: i.startedAt.toISOString(),
        lastOccurrenceAt: i.lastOccurrenceAt.toISOString(),
        acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        assignee:
          lastAssigned === undefined || lastAssigned.message === "Unassigned"
            ? null
            : lastAssigned.message,
        events,
      });
    }

    // Oldest-first so the per-monitor rings end at the newest result.
    for (const r of [...results].reverse()) {
      this.store.pushResult({
        id: r.id,
        monitorId: r.monitorId,
        status: r.status,
        success: r.success,
        responseTimeMs: r.responseTimeMs,
        statusCode: r.statusCode,
        failureReason: r.failureReason,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
        checkedAt: r.checkedAt.toISOString(),
      });
    }

    this.logger.log(`monitoring core hydrated from DB`, {
      projects: projects.length,
      monitors: monitors.length,
      channels: channels.length,
      rules: rules.length,
      windows: windows.length,
      incidents: incidents.length,
      results: results.length,
    });
  }

  /** First boot against an empty schema: the seeded defaults become the DB baseline. */
  private async materializeSeeds(): Promise<void> {
    const prisma = this.prisma as PrismaClient;
    const orgId = this.orgId as string;
    for (const p of this.store.projects) {
      await prisma.project.create({
        data: { id: p.id, orgId, name: p.name, slug: p.slug, isDeleted: p.isDeleted },
      });
      for (const e of p.environments) {
        await prisma.environment.create({
          data: { id: e.id, orgId, projectId: p.id, name: e.name },
        });
      }
    }
    for (const m of this.store.monitors.values()) {
      await prisma.monitor.create({ data: this.monitorData(m, orgId) });
    }
    for (const c of this.store.channels) {
      await prisma.notificationChannel.create({ data: this.channelData(c, orgId) });
    }
    for (const r of this.store.alertRules) {
      await prisma.alertRule.create({ data: this.ruleData(r, orgId) });
    }
    this.logger.log(`seeded monitoring core into DB`, {
      projects: this.store.projects.length,
      monitors: this.store.monitors.size,
      channels: this.store.channels.length,
      rules: this.store.alertRules.length,
    });
  }

  // --- write-through -----------------------------------------------------

  saveProject(p: ProjectRecord): void {
    this.enqueue(`project ${p.id}`, async (prisma, orgId) => {
      await prisma.project.upsert({
        where: { id: p.id },
        create: { id: p.id, orgId, name: p.name, slug: p.slug, isDeleted: p.isDeleted },
        update: { name: p.name, slug: p.slug, isDeleted: p.isDeleted },
      });
      for (const e of p.environments) {
        await prisma.environment.upsert({
          where: { id: e.id },
          create: { id: e.id, orgId, projectId: p.id, name: e.name },
          update: { name: e.name },
        });
      }
    });
  }

  saveMonitor(m: MonitorRecord): void {
    this.enqueue(`monitor ${m.id}`, async (prisma, orgId) => {
      const data = this.monitorData(m, orgId);
      await prisma.monitor.upsert({
        where: { id: m.id },
        create: data,
        update: {
          name: data.name,
          description: data.description,
          projectId: data.projectId,
          environmentId: data.environmentId,
          monitorType: data.monitorType,
          checkIntervalMinutes: data.checkIntervalMinutes,
          timeoutMs: data.timeoutMs,
          retryCount: data.retryCount,
          severity: data.severity,
          tags: data.tags,
          enabled: data.enabled,
          configuration: data.configuration,
          heartbeatToken: data.heartbeatToken,
          isDeleted: m.isDeleted,
          deletedAt: m.isDeleted ? new Date() : null,
        },
      });
    });
  }

  saveChannel(c: ChannelRecord): void {
    this.enqueue(`channel ${c.id}`, async (prisma, orgId) => {
      const data = this.channelData(c, orgId);
      await prisma.notificationChannel.upsert({
        where: { id: c.id },
        create: data,
        update: {
          name: data.name,
          channelType: data.channelType,
          config: data.config,
          enabled: c.enabled,
          isDeleted: c.isDeleted,
          deletedAt: c.isDeleted ? new Date() : null,
        },
      });
    });
  }

  saveRule(r: AlertRuleRecord): void {
    this.enqueue(`rule ${r.id}`, async (prisma, orgId) => {
      const data = this.ruleData(r, orgId);
      await prisma.alertRule.upsert({
        where: { id: r.id },
        create: data,
        update: {
          name: data.name,
          channelId: data.channelId,
          conditions: data.conditions,
          escalationDelaySeconds: r.escalationDelaySeconds,
          priority: r.priority,
          enabled: r.enabled,
          isDeleted: r.isDeleted,
          deletedAt: r.isDeleted ? new Date() : null,
        },
      });
    });
  }

  saveWindow(w: MaintenanceWindowRecord): void {
    this.enqueue(`maintenance window ${w.id}`, async (prisma, orgId) => {
      await prisma.maintenanceWindow.upsert({
        where: { id: w.id },
        create: {
          id: w.id,
          orgId,
          name: w.name,
          scope: w.scope as $Enums.MaintenanceScope,
          projectId: w.projectId,
          environmentId: w.environmentId,
          monitorId: w.monitorId,
          startsAt: new Date(w.startsAt),
          endsAt: new Date(w.endsAt),
          muteExisting: w.muteExisting,
          isDeleted: w.isDeleted,
        },
        update: {
          name: w.name,
          startsAt: new Date(w.startsAt),
          endsAt: new Date(w.endsAt),
          muteExisting: w.muteExisting,
          isDeleted: w.isDeleted,
          deletedAt: w.isDeleted ? new Date() : null,
        },
      });
    });
  }

  saveIncident(i: IncidentRecord): void {
    // Snapshot now — the caller keeps mutating the live record.
    const incident: IncidentRecord = { ...i, events: i.events.map((e) => ({ ...e })) };
    this.enqueue(`incident ${incident.id}`, async (prisma, orgId) => {
      const fields = {
        status: incident.status as $Enums.IncidentStatus,
        severity: incident.severity as $Enums.Severity,
        title: incident.title,
        summary: incident.summary,
        failureReason: incident.failureReason,
        dedupSignature: incident.dedupSignature,
        occurrenceCount: incident.occurrenceCount,
        startedAt: new Date(incident.startedAt),
        lastOccurrenceAt: new Date(incident.lastOccurrenceAt),
        acknowledgedAt: incident.acknowledgedAt === null ? null : new Date(incident.acknowledgedAt),
        resolvedAt: incident.resolvedAt === null ? null : new Date(incident.resolvedAt),
      };
      await prisma.incident.upsert({
        where: { id: incident.id },
        create: { id: incident.id, orgId, monitorId: incident.monitorId, ...fields },
        update: fields,
      });
      if (incident.events.length > 0) {
        await prisma.incidentEvent.createMany({
          data: incident.events.map((e) => ({
            id: e.id,
            orgId,
            incidentId: incident.id,
            eventType: (KNOWN_EVENT_TYPES.has(e.eventType)
              ? e.eventType
              : "note_added") as $Enums.IncidentEventType,
            message: e.message,
            ...(e.actor === null ? {} : { metadata: { actor: e.actor } }),
            createdAt: new Date(e.createdAt),
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  saveResult(r: MonitorResultRecord): void {
    this.enqueue(`result ${r.id}`, async (prisma, orgId) => {
      await prisma.monitorResult.create({
        data: {
          id: r.id,
          orgId,
          monitorId: r.monitorId,
          status: r.status as $Enums.CheckResultStatus,
          success: r.success,
          responseTimeMs: r.responseTimeMs,
          statusCode: r.statusCode,
          failureReason: r.failureReason,
          ...(r.metadata === null ? {} : { metadata: r.metadata as Prisma.InputJsonValue }),
          checkedAt: new Date(r.checkedAt),
        },
      });
    });
  }

  // --- internals ----------------------------------------------------------

  private enqueue(
    label: string,
    op: (prisma: PrismaClient, orgId: string) => Promise<void>,
  ): void {
    const prisma = this.prisma;
    const orgId = this.orgId;
    if (prisma === null || orgId === null) return;
    this.queue = this.queue
      .then(() => op(prisma, orgId))
      .catch((error: unknown) => {
        this.logger.warn(`persist failed (${label}) — in-memory state remains authoritative`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private monitorData(m: MonitorRecord, orgId: string) {
    return {
      id: m.id,
      orgId,
      projectId: m.projectId,
      environmentId: m.environmentId,
      name: m.name,
      description: m.description,
      monitorType: m.monitorType as $Enums.MonitorType,
      checkIntervalMinutes: m.checkIntervalMinutes,
      timeoutMs: m.timeoutMs,
      retryCount: m.retryCount,
      severity: m.severity as $Enums.Severity,
      tags: m.tags,
      enabled: m.enabled,
      configuration: m.configuration as Prisma.InputJsonValue,
      heartbeatToken: m.heartbeatToken,
      isDeleted: m.isDeleted,
      createdAt: new Date(m.createdAt),
    };
  }

  private channelData(c: ChannelRecord, orgId: string) {
    return {
      id: c.id,
      orgId,
      name: c.name,
      channelType: c.channelType as $Enums.NotificationChannelType,
      config: this.encodeChannelConfig(c.config),
      enabled: c.enabled,
      isDeleted: c.isDeleted,
    };
  }

  private ruleData(r: AlertRuleRecord, orgId: string) {
    return {
      id: r.id,
      orgId,
      name: r.name,
      channelId: r.channelId,
      conditions: r.conditions as Prisma.InputJsonValue,
      escalationDelaySeconds: r.escalationDelaySeconds,
      priority: r.priority,
      enabled: r.enabled,
      isDeleted: r.isDeleted,
    };
  }

  /** Channel config carries credentials — AES-encrypted at rest when the key exists. */
  private encodeChannelConfig(config: Record<string, string>): Prisma.InputJsonValue {
    if (env.ENCRYPTION_KEY !== undefined) {
      return { __enc: encryptSecret(JSON.stringify(config), env.ENCRYPTION_KEY) };
    }
    this.logger.warn(`ENCRYPTION_KEY not set — channel config stored unencrypted`);
    return config;
  }

  private decodeChannelConfig(stored: unknown, channelName: string): Record<string, string> {
    if (typeof stored !== "object" || stored === null) return {};
    const obj = stored as Record<string, unknown>;
    if (typeof obj.__enc === "string") {
      if (env.ENCRYPTION_KEY === undefined) {
        this.logger.warn(`cannot decrypt channel "${channelName}" — ENCRYPTION_KEY not set`);
        return {};
      }
      try {
        return JSON.parse(decryptSecret(obj.__enc, env.ENCRYPTION_KEY)) as Record<string, string>;
      } catch (error) {
        this.logger.warn(`channel "${channelName}" config failed to decrypt`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return {};
      }
    }
    return obj as Record<string, string>;
  }
}

function actorFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const actor = (metadata as Record<string, unknown>).actor;
  return typeof actor === "string" ? actor : null;
}
