import { Module } from "@nestjs/common";

import { isLiveMode } from "./config/env";
import { HealthController } from "./health/health.controller";
import { IncidentEngine } from "./monitoring/incident.engine";
import { IncidentsController } from "./monitoring/incidents.controller";
import { IncidentsService } from "./monitoring/incidents.service";
import { HeartbeatsController, InternalController, MiscController } from "./monitoring/internal.controller";
import { MonitoringService } from "./monitoring/monitoring.service";
import { MonitoringStore } from "./monitoring/monitoring.store";
import { MonitorsController, ProjectsController } from "./monitoring/monitors.controller";
import { NotificationDispatcher } from "./monitoring/notification.dispatcher";
import {
  AlertRulesController,
  ChannelsController,
  MaintenanceController,
  ReportsController,
} from "./monitoring/settings.controller";
import { SettingsService } from "./monitoring/settings.service";
import { OverviewController } from "./overview/overview.controller";
import { OverviewService } from "./overview/overview.service";
import { AutomationsController } from "./workflow-events/automations.controller";
import { AutomationsService } from "./workflow-events/automations.service";
import { N8nInsightsService } from "./workflow-events/n8n-insights.service";
import { IngestController } from "./workflow-events/ingest.controller";
import { InMemoryWorkflowEventsRepository } from "./workflow-events/in-memory.repository";
import { N8nGateway } from "./workflow-events/n8n.gateway";
import { WorkflowEventsController } from "./workflow-events/workflow-events.controller";
import { WorkflowSourcesController } from "./workflow-events/workflow-sources.controller";
import { WORKFLOW_EVENTS_REPOSITORY } from "./workflow-events/workflow-events.repository";
import { WorkflowEventsService } from "./workflow-events/workflow-events.service";

@Module({
  controllers: [
    HealthController,
    OverviewController,
    MonitorsController,
    ProjectsController,
    IncidentsController,
    ChannelsController,
    AlertRulesController,
    MaintenanceController,
    ReportsController,
    InternalController,
    HeartbeatsController,
    MiscController,
    WorkflowEventsController,
    WorkflowSourcesController,
    AutomationsController,
    IngestController,
  ],
  providers: [
    OverviewService,
    MonitoringStore,
    MonitoringService,
    IncidentsService,
    SettingsService,
    IncidentEngine,
    NotificationDispatcher,
    WorkflowEventsService,
    AutomationsService,
    N8nInsightsService,
    N8nGateway,
    {
      provide: WORKFLOW_EVENTS_REPOSITORY,
      // Live mode needs only DATABASE_URL; the Prisma repo is imported lazily so
      // sample mode never touches the query engine.
      useFactory: async () => {
        if (!isLiveMode) {
          return new InMemoryWorkflowEventsRepository();
        }
        const { PrismaWorkflowEventsRepository } = await import("./workflow-events/prisma.repository");
        return new PrismaWorkflowEventsRepository();
      },
    },
  ],
})
export class AppModule {}
