import { FormEvent, useEffect, useState } from "react";

import { UNAUTHORIZED_EVENT, setAccessToken } from "../lib/api";

/**
 * Interim access gate UI (until Supabase Auth lands).
 *
 * - Unlock links: opening the app with `#token=<value>` stores the token,
 *   scrubs it from the address bar (fragments never reach server logs), and
 *   reloads — so a bookmarked unlock link re-arms any browser in one click.
 * - Shown when any API call returns 401. The entered token is verified
 *   against the API before it is saved, so a bad paste gets an inline error
 *   instead of silently overwriting a working value.
 */
export function AccessGate(): JSX.Element | null {
  const [locked, setLocked] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "invalid" | "unreachable">("idle");

  useEffect(() => {
    const fromHash = /(?:^#|&)token=([^&]+)/.exec(window.location.hash)?.[1];
    if (fromHash !== undefined) {
      setAccessToken(decodeURIComponent(fromHash));
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      window.location.reload();
      return;
    }
    const onUnauthorized = (): void => setLocked(true);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!locked) return null;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const candidate = token.trim();
    if (candidate.length === 0 || status === "checking") return;
    setStatus("checking");
    let res: Response | null = null;
    try {
      res = await fetch("/api/me", { headers: { "x-access-token": candidate } });
    } catch {
      res = null;
    }
    if (res === null || !res.ok) {
      setStatus(res !== null && res.status === 401 ? "invalid" : "unreachable");
      return;
    }
    setAccessToken(candidate);
    window.location.reload();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: "rgba(0, 0, 0, 0.55)" }}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-xl border p-6 shadow-xl"
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--hairline)",
          color: "var(--ink-primary)",
        }}
      >
        <h2 className="text-base font-semibold">Access token required</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-secondary)" }}>
          This deployment is protected until full sign-in lands. Paste the shared access token to
          continue.
        </p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setStatus("idle");
          }}
          placeholder="Access token"
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--hairline)", background: "var(--surface-inset)" }}
        />
        {status === "invalid" ? (
          <p className="mt-2 text-sm" style={{ color: "var(--status-critical, #dc2626)" }}>
            Invalid token — nothing was saved. Check the value and try again.
          </p>
        ) : null}
        {status === "unreachable" ? (
          <p className="mt-2 text-sm" style={{ color: "var(--status-critical, #dc2626)" }}>
            Could not verify the token — the API did not respond. Try again shortly.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={status === "checking"}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          {status === "checking" ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
