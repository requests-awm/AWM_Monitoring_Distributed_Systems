import { FormEvent, useEffect, useState } from "react";

import { UNAUTHORIZED_EVENT, setAccessToken } from "../lib/api";

/**
 * Shown when any API call returns 401 (the interim access-token gate is on).
 * Stores the entered token and reloads so every query retries with it.
 */
export function AccessGate(): JSX.Element | null {
  const [locked, setLocked] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    const onUnauthorized = (): void => setLocked(true);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!locked) return null;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (token.trim().length === 0) return;
    setAccessToken(token.trim());
    window.location.reload();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: "rgba(0, 0, 0, 0.55)" }}
    >
      <form
        onSubmit={submit}
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
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token"
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--hairline)", background: "var(--surface-inset)" }}
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
