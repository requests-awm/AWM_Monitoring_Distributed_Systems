import { useEffect } from "react";

export interface ToastState {
  id: number;
  message: string;
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
}): JSX.Element {
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
      {toast !== null ? (
        <div
          className="rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg"
          style={{
            background: "var(--surface-card)",
            borderColor: "var(--hairline)",
            color: "var(--ink-primary)",
          }}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
