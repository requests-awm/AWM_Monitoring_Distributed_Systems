import type { WorkflowFailureEvent } from "@awm/shared";

import { fullTime, timeAgo } from "../lib/time";
import {
  EventStatusBadge,
  EventTypeChip,
  PlatformChip,
} from "./WorkflowBadges";

export function WorkflowEventsTable({
  events,
  selectedId,
  onSelect,
  emptyText,
}: {
  events: readonly WorkflowFailureEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
}): JSX.Element {
  if (events.length === 0) {
    return (
      <section className="card px-4 py-10 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--status-good)" }}>
          <span aria-hidden>● </span>
          {emptyText}
        </p>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-left text-xs uppercase tracking-wide"
              style={{ color: "var(--ink-muted)" }}
            >
              <th className="px-4 py-2.5 font-medium">Failure</th>
              <th className="px-4 py-2.5 font-medium">Platform</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Assignee</th>
              <th className="px-4 py-2.5 text-right font-medium">Occurred</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const selected = e.id === selectedId;
              return (
                <tr
                  key={e.id}
                  className="cursor-pointer border-t transition-colors hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{
                    borderColor: "var(--hairline)",
                    background: selected ? "var(--surface-inset)" : undefined,
                  }}
                  onClick={() => onSelect(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onSelect(e.id);
                    }
                  }}
                  tabIndex={0}
                  aria-selected={selected}
                >
                  <td className="max-w-[420px] px-4 py-3">
                    <div className="flex items-center gap-2">
                      {Date.now() - new Date(e.receivedAt).getTime() < 10 * 60_000 ? (
                        <span
                          aria-label="Newly detected"
                          title={`Detected ${timeAgo(e.receivedAt)}`}
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: "var(--accent)" }}
                        />
                      ) : null}
                      <span className="truncate font-medium">{e.workflowName}</span>
                      <EventTypeChip eventType={e.eventType} />
                    </div>
                    <div className="mt-0.5 truncate text-xs" style={{ color: "var(--ink-muted)" }}>
                      {e.errorNode !== null ? `${e.errorNode} — ` : ""}
                      {e.errorMessage}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <PlatformChip platform={e.platform} />
                  </td>
                  <td className="px-4 py-3">
                    <EventStatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--ink-secondary)" }}>
                    {e.assignee ?? "—"}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums"
                    style={{ color: "var(--ink-muted)" }}
                    title={fullTime(e.occurredAt)}
                  >
                    {timeAgo(e.occurredAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
