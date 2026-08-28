import { Controller, Get } from "@nestjs/common";

import { isLiveMode } from "../config/env";

@Controller()
export class HealthController {
  @Get("health")
  liveness(): { status: string; service: string; mode: "sample" | "live"; timestamp: string } {
    return {
      status: "ok",
      service: "api",
      mode: isLiveMode ? "live" : "sample",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("health/ready")
  readiness(): { status: string } {
    return { status: "ready" };
  }
}
