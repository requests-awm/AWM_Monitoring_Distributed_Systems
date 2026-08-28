import { Controller, Get } from "@nestjs/common";
import type { OverviewResponse } from "@awm/shared";

import { OverviewService } from "./overview.service";

@Controller("overview")
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  getOverview(): OverviewResponse {
    return this.overview.getOverview();
  }
}
