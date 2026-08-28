export function StatTile({
  label,
  value,
  suffix,
  accent,
  muted,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  accent?: string;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="card px-4 py-3">
      <div
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--ink-muted)" }}
      >
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className="text-2xl font-semibold tabular-nums"
          style={{ color: muted ? "var(--ink-secondary)" : (accent ?? "var(--ink-primary)") }}
        >
          {value}
        </span>
        {suffix ? (
          <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}
