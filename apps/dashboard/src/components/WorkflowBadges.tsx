import type { ButtonHTMLAttributes } from "react";
import type { WorkflowEventStatus, WorkflowEventType, WorkflowPlatform } from "@awm/shared";

import { EVENT_STATUS_META, EVENT_TYPE_META, PLATFORM_LABEL } from "../lib/workflowMeta";

export function PlatformChip({ platform }: { platform: WorkflowPlatform }): JSX.Element {
  return (
    <span
      className="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ background: "var(--surface-inset)", color: "var(--ink-secondary)" }}
    >
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

export function EventStatusBadge({ status }: { status: WorkflowEventStatus }): JSX.Element {
  const meta = EVENT_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap">
      <span aria-hidden style={{ color: meta.color }}>
        {meta.symbol}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}

/** Shown only for the non-default event types, where the type itself is the news. */
export function EventTypeChip({ eventType }: { eventType: WorkflowEventType }): JSX.Element | null {
  const meta = EVENT_TYPE_META[eventType];
  if (meta.color === null) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ color: meta.color, background: "var(--surface-inset)" }}
    >
      <span aria-hidden>▲</span>
      {meta.label}
    </span>
  );
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "accent" | "default";
}

export function ActionButton({
  tone = "default",
  className = "",
  style,
  ...rest
}: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors enabled:hover:bg-[var(--surface-inset)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${className}`}
      style={{
        borderColor: tone === "accent" ? "var(--accent)" : "var(--hairline)",
        color: tone === "accent" ? "var(--accent)" : "var(--ink-secondary)",
        background: "transparent",
        ...style,
      }}
      {...rest}
    />
  );
}

export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: string;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
      style={{ borderColor: "var(--hairline)", color: "var(--ink-secondary)" }}
    >
      {children}
      <span aria-hidden>↗</span>
    </a>
  );
}
