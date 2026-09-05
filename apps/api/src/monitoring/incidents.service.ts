import { Injectable, NotFoundException } from "@nestjs/common";
import type { IncidentDetailResponse, IncidentDto } from "@awm/shared";

import { MonitoringPersistence } from "./monitoring.persistence";
import { MonitoringStore, type IncidentRecord } from "./monitoring.store";

@Injectable()
export class IncidentsService {
  constructor(
    private readonly store: MonitoringStore,
    private readonly persistence: MonitoringPersistence,
  ) {}

  list(): IncidentDto[] {
    return [...this.store.incidents.values()]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map((i) => this.toDto(i));
  }

  detail(id: string): IncidentDetailResponse {
    const incident = this.mustGet(id);
    return { incident: this.toDto(incident), events: [...incident.events].reverse() };
  }

  acknowledge(id: string, actor: string): IncidentDto {
    const incident = this.mustGet(id);
    if (incident.acknowledgedAt === null) {
      incident.acknowledgedAt = new Date().toISOString();
      if (incident.status === "open") incident.status = "acknowledged";
      this.addEvent(incident, "acknowledged", null, actor);
      this.persistence.saveIncident(incident);
      this.store.audit("incident_acknowledged", actor, "incident", id, null);
    }
    return this.toDto(incident);
  }

  resolve(id: string, actor: string): IncidentDto {
    const incident = this.mustGet(id);
    if (incident.status !== "resolved") {
      incident.status = "resolved";
      incident.resolvedAt = new Date().toISOString();
      this.addEvent(incident, "resolved", "Resolved manually", actor);
      this.persistence.saveIncident(incident);
      this.store.audit("incident_resolved", actor, "incident", id, null);
    }
    return this.toDto(incident);
  }

  mute(id: string, actor: string): IncidentDto {
    const incident = this.mustGet(id);
    incident.status = "muted";
    this.addEvent(incident, "muted", null, actor);
    this.persistence.saveIncident(incident);
    return this.toDto(incident);
  }

  assign(id: string, assignee: string | null, actor: string): IncidentDto {
    const incident = this.mustGet(id);
    incident.assignee = assignee;
    this.addEvent(incident, "assigned", assignee ?? "Unassigned", actor);
    this.persistence.saveIncident(incident);
    return this.toDto(incident);
  }

  addNote(id: string, message: string, actor: string): IncidentDto {
    const incident = this.mustGet(id);
    this.addEvent(incident, "note_added", message, actor);
    this.persistence.saveIncident(incident);
    return this.toDto(incident);
  }

  private addEvent(incident: IncidentRecord, eventType: string, message: string | null, actor: string): void {
    incident.events.push({
      id: this.store.newId("iev"),
      eventType,
      message,
      actor,
      createdAt: new Date().toISOString(),
    });
  }

  private mustGet(id: string): IncidentRecord {
    const incident = this.store.incidents.get(id);
    if (incident === undefined) throw new NotFoundException(`Incident ${id} not found`);
    return incident;
  }

  private toDto(i: IncidentRecord): IncidentDto {
    const monitor = this.store.monitors.get(i.monitorId);
    const project = monitor === undefined ? undefined : this.store.project(monitor.projectId);
    return {
      id: i.id,
      monitorId: i.monitorId,
      monitorName: monitor?.name ?? i.monitorId,
      projectName: project?.name ?? "—",
      environmentName:
        monitor === undefined ? "—" : this.store.environmentName(monitor.projectId, monitor.environmentId),
      status: i.status,
      severity: i.severity,
      title: i.title,
      summary: i.summary,
      failureReason: i.failureReason,
      occurrenceCount: i.occurrenceCount,
      startedAt: i.startedAt,
      lastOccurrenceAt: i.lastOccurrenceAt,
      acknowledgedAt: i.acknowledgedAt,
      resolvedAt: i.resolvedAt,
      assignee: i.assignee,
    };
  }
}
