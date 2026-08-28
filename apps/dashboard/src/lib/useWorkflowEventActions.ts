import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { WorkflowEventActionResult, WorkflowEventsResponse } from "@awm/shared";

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

async function postAction({ id, action, body }: WorkflowEventActionInput): Promise<WorkflowEventActionResult> {
  const res = await fetch(`/api/workflow-events/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? `${action} failed with status ${res.status}`);
  }
  return (await res.json()) as WorkflowEventActionResult;
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
