import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { OverviewResponse } from "@awm/shared";

import { apiGet } from "./api";

function fetchOverview(): Promise<OverviewResponse> {
  return apiGet<OverviewResponse>("/api/overview");
}

/** Live overview data from the API. Refetches every 15s so the dashboard updates on its own. */
export function useOverviewData(): UseQueryResult<OverviewResponse> {
  return useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    refetchInterval: 15_000,
  });
}
