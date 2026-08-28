import { STATUS_META, type DisplayStatus } from "../lib/status";

/** A compact history strip: one cell per recent check, oldest → newest. */
export function UptimeStrip({
  history,
}: {
  history: readonly DisplayStatus[];
}): JSX.Element {
  return (
    <div className="flex items-end gap-[2px]" role="img" aria-label="Recent check history">
      {history.map((s, i) => (
        <span
          key={i}
          title={STATUS_META[s].label}
          style={{ background: STATUS_META[s].color }}
          className="inline-block h-4 w-[5px] rounded-[1px]"
        />
      ))}
    </div>
  );
}
