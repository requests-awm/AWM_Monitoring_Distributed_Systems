import { readFileSync } from "node:fs";

const API = (process.env.AWM_API_BASE ?? "http://localhost:3010/api").replace(/\/+$/, "");
const WORKER_TOKEN = process.env.AWM_WORKER_TOKEN ?? "dev-worker-token-sample";
const INGEST_TOKEN = process.env.AWM_INGEST_TOKEN_ZAPIER ?? "dev-ingest-zapier-sample-token";
const ACCESS_TOKEN = process.env.AWM_ACCESS_TOKEN ?? "";

const baseHeaders = { "content-type": "application/json" };
if (ACCESS_TOKEN !== "") baseHeaders["x-access-token"] = ACCESS_TOKEN;

const rows = JSON.parse(readFileSync(new URL("./errlog.json", import.meta.url), "utf8"));
const livePairs = JSON.parse(readFileSync(new URL("./zaps.json", import.meta.url), "utf8"));
const liveNames = new Map(livePairs.map(([id, name]) => [id, name]));

let ingested = 0, duplicates = 0, failed = 0;
for (const [row, ts, name, zapId] of rows) {
  const occurredAt = `${ts.replace(" ", "T")}+02:00`; // sheet timezone Africa/Johannesburg
  const res = await fetch(`${API}/ingest/workflow-events`, {
    method: "POST",
    headers: { ...baseHeaders, authorization: `Bearer ${INGEST_TOKEN}` },
    body: JSON.stringify({
      platform: "zapier",
      event_type: "execution_failed",
      workflow: { external_id: zapId, name },
      execution: {
        external_id: `errlog-row-${row}`,
        url: `https://zapier.com/app/history?root_id=${zapId}`,
      },
      error: { message: "Zap error (from Zapier Error Log sheet; open Zap history for details)" },
      occurred_at: occurredAt,
    }),
  });
  if (res.ok) {
    const body = await res.json();
    body.duplicate ? duplicates++ : ingested++;
  } else {
    failed++;
    console.error(`row ${row}: ${res.status} ${await res.text()}`);
  }
}
console.log(`events: ingested=${ingested} duplicates=${duplicates} failed=${failed}`);

const byZap = new Map();
for (const [, ts, name, zapId] of rows) {
  const cur = byZap.get(zapId);
  if (cur === undefined || ts > cur.lastAt) byZap.set(zapId, { name, lastAt: ts });
}
const zaps = [...byZap.entries()].map(([id, { name }]) => ({
  external_id: id,
  name,
  state: liveNames.has(id) ? "on" : "unknown",
  editor_url: `https://zapier.com/editor/${id}`,
  history_url: `https://zapier.com/app/history?root_id=${id}`,
}));

const res = await fetch(`${API}/internal/zap-inventory`, {
  method: "POST",
  headers: { ...baseHeaders, authorization: `Bearer ${WORKER_TOKEN}` },
  body: JSON.stringify({ source: "zapier-mcp (failing zaps, from Zapier Error Log sheet)", zaps }),
});
console.log("snapshot:", res.status, await res.text(), `(${zaps.length} failing zaps)`);
