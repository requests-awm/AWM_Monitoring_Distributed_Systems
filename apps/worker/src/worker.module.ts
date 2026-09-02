import { Module } from "@nestjs/common";

import { ProviderCostsService } from "./billing/provider-costs.service";
import { CheckPollerService } from "./checks/poller.service";
import { N8nSweepService } from "./sweep/n8n-sweep.service";
import { ProviderReferencesService } from "./sweep/provider-references.service";

/**
 * Root module for the monitoring worker process. The check poller executes
 * due monitors against the API's internal contract; BullMQ consumers replace
 * the interval loop in M2 once Redis is provisioned.
 */
@Module({
  providers: [CheckPollerService, N8nSweepService, ProviderReferencesService, ProviderCostsService],
})
export class WorkerModule {}
