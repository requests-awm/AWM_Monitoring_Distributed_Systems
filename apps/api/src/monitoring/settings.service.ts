import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AlertRuleCreateBody, AlertRuleDto, ChannelCreateBody, NotificationChannelDto } from "@awm/shared";

import { MonitoringPersistence } from "./monitoring.persistence";
import { MonitoringStore, type AlertRuleRecord, type ChannelRecord } from "./monitoring.store";

const SENSITIVE_CONFIG_KEYS = new Set(["token", "password", "authToken", "apiKey", "secret"]);

@Injectable()
export class SettingsService {
  constructor(
    private readonly store: MonitoringStore,
    private readonly persistence: MonitoringPersistence,
  ) {}

  listChannels(): NotificationChannelDto[] {
    return this.store.channels.filter((c) => !c.isDeleted).map((c) => this.toChannelDto(c));
  }

  createChannel(body: ChannelCreateBody, actor: string): NotificationChannelDto {
    const channel: ChannelRecord = {
      id: this.store.newId("chan"),
      name: body.name,
      channelType: body.channelType,
      config: body.config,
      enabled: body.enabled,
      isDeleted: false,
    };
    this.store.channels.push(channel);
    this.persistence.saveChannel(channel);
    this.store.audit("notification_channel_changed", actor, "notification_channel", channel.id, {
      created: true,
    });
    return this.toChannelDto(channel);
  }

  deleteChannel(id: string, actor: string): void {
    const channel = this.store.channels.find((c) => c.id === id && !c.isDeleted);
    if (channel === undefined) throw new NotFoundException(`Channel ${id} not found`);
    if (this.store.alertRules.some((r) => !r.isDeleted && r.channelId === id)) {
      throw new BadRequestException("Channel is used by an alert rule — delete the rule first");
    }
    channel.isDeleted = true;
    this.persistence.saveChannel(channel);
    this.store.audit("notification_channel_changed", actor, "notification_channel", id, { deleted: true });
  }

  listRules(): AlertRuleDto[] {
    return this.store.alertRules.filter((r) => !r.isDeleted).map((r) => this.toRuleDto(r));
  }

  createRule(body: AlertRuleCreateBody, actor: string): AlertRuleDto {
    if (!this.store.channels.some((c) => c.id === body.channelId && !c.isDeleted)) {
      throw new BadRequestException("Unknown notification channel");
    }
    const rule: AlertRuleRecord = {
      id: this.store.newId("rule"),
      name: body.name,
      channelId: body.channelId,
      conditions: body.conditions,
      escalationDelaySeconds: body.escalationDelaySeconds ?? null,
      priority: body.priority,
      enabled: body.enabled,
      isDeleted: false,
    };
    this.store.alertRules.push(rule);
    this.persistence.saveRule(rule);
    this.store.audit("alert_rule_changed", actor, "alert_rule", rule.id, { created: true });
    return this.toRuleDto(rule);
  }

  deleteRule(id: string, actor: string): void {
    const rule = this.store.alertRules.find((r) => r.id === id && !r.isDeleted);
    if (rule === undefined) throw new NotFoundException(`Alert rule ${id} not found`);
    rule.isDeleted = true;
    this.persistence.saveRule(rule);
    this.store.audit("alert_rule_changed", actor, "alert_rule", id, { deleted: true });
  }

  private toChannelDto(c: ChannelRecord): NotificationChannelDto {
    const configMasked: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.config)) {
      configMasked[key] = SENSITIVE_CONFIG_KEYS.has(key) ? "•••" : value;
    }
    return { id: c.id, name: c.name, channelType: c.channelType, enabled: c.enabled, configMasked };
  }

  private toRuleDto(r: AlertRuleRecord): AlertRuleDto {
    const channel = this.store.channels.find((c) => c.id === r.channelId);
    return {
      id: r.id,
      name: r.name,
      channelId: r.channelId,
      channelName: channel?.name ?? r.channelId,
      conditions: r.conditions,
      escalationDelaySeconds: r.escalationDelaySeconds,
      priority: r.priority,
      enabled: r.enabled,
    };
  }
}
