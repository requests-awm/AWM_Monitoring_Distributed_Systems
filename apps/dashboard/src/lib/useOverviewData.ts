import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { OverviewResponse } from "@awm/shared";

async function fetchOverview(): Promise<OverviewResponse> {
  const res = await fetch("/api/overview");
  if (!res.ok) {
    throw new Error(`Overview request failed: ${res.status}`);
  }
  return (await res.json()) as OverviewResponse;
}

/** Live overview data from the API. Refetches every 15s so the dashboard updates on its own. */
export function useOverviewData(): UseQueryResult<OverviewResponse> {
  return useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    refetchInterval: 15_000,
  });
}
