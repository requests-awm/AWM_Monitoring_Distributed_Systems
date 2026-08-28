import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { WorkflowEventsResponse } from "@awm/shared";

async function fetchWorkflowEvents(): Promise<WorkflowEventsResponse> {
  const res = await fetch("/api/workflow-events");
  if (!res.ok) {
    throw new Error(`Workflow events request failed: ${res.status}`);
  }
  return (await res.json()) as WorkflowEventsResponse;
}

/** Failure inbox data. Polls every 15s until the SSE channel exists. */
export function useWorkflowEvents(): UseQueryResult<WorkflowEventsResponse> {
  return useQuery({
    queryKey: ["workflow-events"],
    queryFn: fetchWorkflowEvents,
    refetchInterval: 15_000,
  });
}
