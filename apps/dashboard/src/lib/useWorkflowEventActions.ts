import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { WorkflowEventActionResult, WorkflowEventsResponse } from "@awm/shared";

import { apiSend } from "./api";

export type WorkflowEventActionName =
  | "acknowledge"
  | "resolve"
  | "ignore"
  | "assign"
  | "retry"
  | "apply-fix"
  | "resubmit";

export interface WorkflowEventActionInput {
  id: string;
  action: WorkflowEventActionName;
  body?: unknown;
}

function postAction({ id, action, body }: WorkflowEventActionInput): Promise<WorkflowEventActionResult> {
  return apiSend<WorkflowEventActionResult>(
    `/api/workflow-events/${encodeURIComponent(id)}/${action}`,
    "POST",
    body,
  );
}

/** Mutations for the failure inbox; the updated event is patched into the query cache immediately. */
export function useWorkflowEventAction(): UseMutationResult<
  WorkflowEventActionResult,
  Error,
  WorkflowEventActionInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postAction,
    onSuccess: (result) => {
      queryClient.setQueryData<WorkflowEventsResponse>(["workflow-events"], (old) =>
        old === undefined
          ? old
          : { ...old, events: old.events.map((e) => (e.id === result.event.id ? result.event : e)) },
      );
    },
  });
}
