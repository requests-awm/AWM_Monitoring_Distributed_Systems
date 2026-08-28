import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlertRuleDto,
  NotificationChannelDto,
  NotificationChannelType,
  Severity,
} from "@awm/shared";

import { Toast, type ToastState } from "../components/Toast";
import { ActionButton } from "../components/WorkflowBadges";
import { apiGet, apiSend } from "../lib/api";

const inputClass =
  "rounded-lg border px-3 py-2 text-sm font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";
const inputStyle = {
  borderColor: "var(--hairline)",
  background: "var(--surface-card)",
  color: "var(--ink-primary)",
} as const;

const CHANNEL_TYPES: { value: NotificationChannelType; label: string; configKey: string; hint: string }[] = [
  { value: "email", label: "Email", configKey: "to", hint: "recipient address" },
  { value: "slack", label: "Slack", configKey: "url", hint: "incoming webhook URL" },
  { value: "teams", label: "Microsoft Teams", configKey: "url", hint: "incoming webhook URL" },
  { value: "webhook", label: "Webhook", configKey: "url", hint: "POST endpoint URL" },
  { value: "asana", label: "Asana", configKey: "projectGid", hint: "project GID (token set server-side)" },
  { value: "sms", label: "SMS (Twilio)", configKey: "to", hint: "phone number, e.g. +27…" },
  { value: "whatsapp", label: "WhatsApp (Twilio)", configKey: "to", hint: "phone number, e.g. +27…" },
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export default function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: () => apiGet<NotificationChannelDto[]>("/api/channels"),
  });
  const rules = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => apiGet<AlertRuleDto[]>("/api/alert-rules"),
  });

  const [chanName, setChanName] = useState("");
  const [chanType, setChanType] = useState<NotificationChannelType>("slack");
  const [chanValue, setChanValue] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [ruleChannel, setRuleChannel] = useState("");
  const [ruleSeverities, setRuleSeverities] = useState<Severity[]>(["critical", "high"]);
  const [ruleEscalation, setRuleEscalation] = useState("600");
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify = (message: string): void => setToast({ id: Date.now(), message });

  const typeMeta =
    CHANNEL_TYPES.find((t) => t.value === chanType) ??
    ({ value: "webhook", label: "Webhook", configKey: "url", hint: "POST endpoint URL" } as const);

  const createChannel = (): void => {
    apiSend("/api/channels", "POST", {
      name: chanName,
      channelType: chanType,
      config: { [typeMeta.configKey]: chanValue },
      enabled: true,
    })
      .then(() => {
        notify(`Channel “${chanName}” added`);
        setChanName("");
        setChanValue("");
        void queryClient.invalidateQueries({ queryKey: ["channels"] });
      })
      .catch((e: Error) => notify(`Failed: ${e.message}`));
  };

  const createRule = (): void => {
    apiSend("/api/alert-rules", "POST", {
      name: ruleName,
      channelId: ruleChannel === "" ? channels.data?.[0]?.id : ruleChannel,
      conditions: { severities: ruleSeverities.length === SEVERITIES.length ? undefined : ruleSeverities },
      escalationDelaySeconds: ruleEscalation.trim() === "" ? null : Number(ruleEscalation),
      priority: 0,
      enabled: true,
    })
      .then(() => {
        notify(`Alert rule “${ruleName}” added`);
        setRuleName("");
        void queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      })
      .catch((e: Error) => notify(`Failed: ${e.message}`));
  };

  const remove = (path: string, key: string, label: string): void => {
    apiSend(path, "DELETE")
      .then(() => {
        notify(`${label} removed`);
        void queryClient.invalidateQueries({ queryKey: [key] });
      })
      .catch((e: Error) => notify(`Failed: ${e.message}`));
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Alerting settings</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          Channels are where alerts go; rules decide which incidents reach which channel and when to escalate.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <header className="border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
            <h2 className="text-sm font-semibold">Notification channels</h2>
          </header>
          <div className="px-4 py-3">
            <ul className="mb-4 flex flex-col gap-2">
              {(channels.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-3 text-sm">
                  <span
                    className="rounded-md px-2 py-0.5 text-xs font-semibold"
                    style={{ background: "var(--surface-inset)", color: "var(--ink-secondary)" }}
                  >
                    {c.channelType}
                  </span>
                  <span className="font-medium">{c.name}</span>
                  <span className="min-w-0 truncate text-xs" style={{ color: "var(--ink-muted)" }}>
                    {Object.values(c.configMasked).join(" · ")}
                  </span>
                  <span className="ml-auto" />
                  <ActionButton onClick={() => remove(`/api/channels/${c.id}`, "channels", "Channel")}>
                    Remove
                  </ActionButton>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-3 items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Name
                <input value={chanName} onChange={(e) => setChanName(e.target.value)} className={inputClass} style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Type
                <select value={chanType} onChange={(e) => setChanType(e.target.value as NotificationChannelType)} className={inputClass} style={inputStyle}>
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {typeMeta.hint}
                <input value={chanValue} onChange={(e) => setChanValue(e.target.value)} className={inputClass} style={inputStyle} />
              </label>
            </div>
            <div className="mt-3">
              <ActionButton tone="accent" onClick={createChannel} disabled={chanName.trim().length < 2 || chanValue.trim() === ""}>
                Add channel
              </ActionButton>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <header className="border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
            <h2 className="text-sm font-semibold">Alert rules</h2>
          </header>
          <div className="px-4 py-3">
            <ul className="mb-4 flex flex-col gap-2">
              {(rules.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {(r.conditions.severities ?? ["any severity"]).join(", ")} → {r.channelName}
                    {r.escalationDelaySeconds !== null ? ` · escalate after ${r.escalationDelaySeconds}s` : ""}
                  </span>
                  <span className="ml-auto" />
                  <ActionButton onClick={() => remove(`/api/alert-rules/${r.id}`, "alert-rules", "Rule")}>
                    Remove
                  </ActionButton>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Name
                <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} className={inputClass} style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Channel
                <select value={ruleChannel} onChange={(e) => setRuleChannel(e.target.value)} className={inputClass} style={inputStyle}>
                  {(channels.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <fieldset className="flex flex-col gap-1 text-sm font-medium">
                <legend className="mb-1">Severities</legend>
                <div className="flex flex-wrap gap-2">
                  {SEVERITIES.map((s) => (
                    <label key={s} className="flex items-center gap-1 text-xs font-normal">
                      <input
                        type="checkbox"
                        checked={ruleSeverities.includes(s)}
                        onChange={(e) =>
                          setRuleSeverities((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))
                        }
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Escalate after (seconds)
                <input value={ruleEscalation} onChange={(e) => setRuleEscalation(e.target.value)} className={inputClass} style={inputStyle} placeholder="blank = never" />
              </label>
            </div>
            <div className="mt-3">
              <ActionButton tone="accent" onClick={createRule} disabled={ruleName.trim().length < 2 || ruleSeverities.length === 0}>
                Add rule
              </ActionButton>
            </div>
          </div>
        </section>
      </div>

      <p className="mt-4 text-xs" style={{ color: "var(--ink-muted)" }}>
        Webhook, Slack, Teams and Asana (with a token) deliver for real. Email sends once the provider is chosen (M5 decision);
        SMS and WhatsApp send for real when Twilio credentials are set server-side. Every delivery attempt is logged on the incident timeline.
      </p>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
