import { Injectable, Logger } from "@nestjs/common";

import { env } from "../config/env";
import type { ChannelRecord } from "./monitoring.store";

export interface SendOutcome {
  ok: boolean;
  detail: string;
}

/**
 * Multi-channel alert delivery. Channels with reachable transports (webhook,
 * Slack, Teams, Asana with a token, Twilio SMS/WhatsApp with credentials)
 * send for real; everything else is simulated and says so, so the pipeline is
 * identical in sample and live mode.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  async send(
    channel: ChannelRecord,
    subject: string,
    body: string,
    payload: Record<string, unknown>,
  ): Promise<SendOutcome> {
    try {
      switch (channel.channelType) {
        case "webhook":
          return await this.postJson(channel.config.url, { subject, body, ...payload });
        case "slack":
        case "teams":
          return await this.postJson(channel.config.url, { text: `**${subject}**\n${body}` });
        case "asana":
          return await this.sendAsana(channel, subject, body);
        case "sms":
        case "whatsapp":
          return await this.sendTwilio(channel, subject, body);
        case "email":
          // TODO(m3): real provider (Resend / SendGrid / MS Graph) once chosen — plan §7.6.
          return { ok: true, detail: `Simulated email to ${channel.config.to ?? "unknown"}` };
        default:
          return { ok: false, detail: `Unknown channel type ${channel.channelType as string}` };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`send failed`, { channel: channel.name, detail });
      return { ok: false, detail };
    }
  }

  private async postJson(url: string | undefined, body: unknown): Promise<SendOutcome> {
    if (url === undefined || url === "") {
      return { ok: false, detail: "Channel has no webhook URL configured" };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok
      ? { ok: true, detail: `Delivered to ${new URL(url).host}` }
      : { ok: false, detail: `Webhook returned ${res.status}` };
  }

  private async sendAsana(channel: ChannelRecord, subject: string, body: string): Promise<SendOutcome> {
    const token = channel.config.token;
    const projectGid = channel.config.projectGid;
    if (token === undefined || projectGid === undefined) {
      return { ok: true, detail: "Simulated Asana task (set token + projectGid to create real tasks)" };
    }
    const res = await fetch("https://app.asana.com/api/1.0/tasks", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ data: { name: subject, notes: body, projects: [projectGid] } }),
    });
    return res.ok
      ? { ok: true, detail: "Asana task created" }
      : { ok: false, detail: `Asana returned ${res.status}` };
  }

  private async sendTwilio(channel: ChannelRecord, subject: string, body: string): Promise<SendOutcome> {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: auth, TWILIO_FROM: from } = env;
    const to = channel.config.to;
    if (sid === undefined || auth === undefined || from === undefined || to === undefined) {
      return {
        ok: true,
        detail: `Simulated ${channel.channelType} to ${to ?? "unknown"} (set TWILIO_* env to send for real)`,
      };
    }
    const prefix = channel.channelType === "whatsapp" ? "whatsapp:" : "";
    const params = new URLSearchParams({
      To: `${prefix}${to}`,
      From: `${prefix}${from}`,
      Body: `${subject}\n${body}`,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    return res.ok
      ? { ok: true, detail: `Twilio ${channel.channelType} queued` }
      : { ok: false, detail: `Twilio returned ${res.status}` };
  }
}
