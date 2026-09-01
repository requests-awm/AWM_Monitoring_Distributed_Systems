const API = (process.env.AWM_API_BASE ?? "http://localhost:3010/api").replace(/\/+$/, "");
const INGEST_TOKEN = process.env.AWM_INGEST_TOKEN_N8N ?? "dev-ingest-n8n-sample-token";
const ACCESS_TOKEN = process.env.AWM_ACCESS_TOKEN ?? "";
const N8N_BASE = (process.env.N8N_BASE_URL ?? "https://n8n.ascotwm.com").replace(/\/+$/, "");
const N8N_KEY = process.env.N8N_API_KEY;
if (!N8N_KEY) throw new Error("N8N_API_KEY is required");

const WINDOW_MS = 7 * 24 * 60 * 60_000;
const cutoff = Date.now() - WINDOW_MS;

const n8nHeaders = { "X-N8N-API-KEY": N8N_KEY };
const apiHeaders = {
  "content-type": "application/json",
  authorization: `Bearer ${INGEST_TOKEN}`,
};
if (ACCESS_TOKEN !== "") apiHeaders["x-access-token"] = ACCESS_TOKEN;

// Collect failed executions inside the window (newest first, stop once older).
const executions = [];
let cursor = null;
for (let page = 0; page < 20; page += 1) {
  const url = `${N8N_BASE}/api/v1/executions?status=error&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(url, { headers: n8nHeaders });
  if (!res.ok) throw new Error(`n8n executions returned ${res.status}`);
  const body = await res.json();
  let pastWindow = false;
  for (const e of body.data ?? []) {
    if (new Date(e.startedAt).getTime() < cutoff) { pastWindow = true; break; }
    executions.push(e);
  }
  cursor = body.nextCursor ?? null;
  if (pastWindow || cursor === null) break;
}
console.log(`failed executions in window: ${executions.length}`);

const nameCache = new Map();
async function workflowName(id) {
  if (nameCache.has(id)) return nameCache.get(id);
  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${id}`, { headers: n8nHeaders });
  const name = res.ok ? (await res.json()).name ?? String(id) : String(id);
  nameCache.set(id, name);
  return name;
}

let ingested = 0, duplicates = 0, failed = 0;
for (const e of executions) {
  const wfId = String(e.workflowId);
  const res = await fetch(`${API}/ingest/workflow-events`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({
      platform: "n8n",
      event_type: "execution_failed",
      workflow: { external_id: wfId, name: await workflowName(wfId) },
      execution: {
        external_id: String(e.id),
        url: `${N8N_BASE}/workflow/${wfId}/executions/${e.id}`,
      },
      error: { message: "n8n execution failed (open the execution for the node-level error)" },
      occurred_at: new Date(e.startedAt).toISOString(),
    }),
  });
  if (res.ok) {
    const body = await res.json();
    body.duplicate ? duplicates++ : ingested++;
  } else {
    failed++;
    console.error(`execution ${e.id}: ${res.status} ${await res.text()}`);
  }
}
console.log(`events: ingested=${ingested} duplicates=${duplicates} failed=${failed} (distinct workflows: ${nameCache.size})`);
