import http from "http";
import { ServiceStateSnapshot } from "./serviceState";

export interface HealthCheckResult {
  ok: boolean;
  reason?: string;
  latencyMs?: number;
  statusCode?: number;
}

export type HealthCheck = () => Promise<HealthCheckResult> | HealthCheckResult;

export interface HealthServerOptions {
  port: number;
  host: string;
  serviceName: string;
  getState: () => ServiceStateSnapshot;
  deriveState?: (checks: Record<string, HealthCheckResult>) => ServiceStateSnapshot;
  checks: Record<string, HealthCheck>;
}

async function runChecks(
  checks: Record<string, HealthCheck>
): Promise<Record<string, HealthCheckResult>> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        const result = await Promise.resolve(check());
        return [name, result] as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return [name, { ok: false, reason: message }] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

export function startHealthServer(options: HealthServerOptions): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/healthz") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const checks = await runChecks(options.checks);
    const state = options.deriveState ? options.deriveState(checks) : options.getState();
    const dependenciesOk = Object.values(checks).every((check) => check.ok);
    const ok = dependenciesOk && state.state === "READY";

    res.statusCode = ok ? 200 : 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok,
        service: options.serviceName,
        state,
        checks,
        timestamp: new Date().toISOString()
      })
    );
  });

  server.listen(options.port, options.host);
  return server;
}
