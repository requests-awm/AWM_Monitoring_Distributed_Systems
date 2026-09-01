import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { WorkflowEventsResponse } from "@awm/shared";

import { apiGet } from "./api";

function fetchWorkflowEvents(): Promise<WorkflowEventsResponse> {
  return apiGet<WorkflowEventsResponse>("/api/workflow-events");
}

/** Failure inbox data. Polls every 15s until the SSE channel exists. */
export function useWorkflowEvents(): UseQueryResult<WorkflowEventsResponse> {
  return useQuery({
    queryKey: ["workflow-events"],
    queryFn: fetchWorkflowEvents,
    refetchInterval: 15_000,
  });
}
