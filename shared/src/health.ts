import http from "http";
import https from "https";
import { URL } from "url";
import { createLogger } from "./logger";

export type HealthCheck = () => Promise<boolean> | boolean;

interface HealthServerOptions {
  port: number;
  host: string;
  checks: Record<string, HealthCheck>;
}

type HealthStatus = "up" | "down";
type HealthDownReason = "timeout" | "connection_refused" | "invalid_response";

interface HealthCheckResult {
  status: HealthStatus;
  reason?: HealthDownReason;
}

interface SimpleHealthServerOptions {
  port: number;
  host: string;
}

interface HealthCheckerOptions {
  intervalMs: number;
  timeoutMs: number;
}

export function createHealthServer(options: HealthServerOptions): http.Server {
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }

    if (req.url.startsWith("/health")) {
      res.statusCode = 200;
      res.end("ok");
      return;
    }

    if (req.url.startsWith("/ready")) {
      const results: Record<string, boolean> = {};
      for (const [name, check] of Object.entries(options.checks)) {
        try {
          results[name] = await Promise.resolve(check());
        } catch {
          results[name] = false;
        }
      }
      const ready = Object.values(results).every(Boolean);
      res.statusCode = ready ? 200 : 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ready, checks: results }));
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  server.listen(options.port, options.host);
  return server;
}

export function startHealthServer(
  serviceName: string,
  options: SimpleHealthServerOptions
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/healthz") {
      res.statusCode = 404;
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        service: serviceName,
        timestamp: new Date().toISOString()
      })
    );
  });

  server.listen(options.port, options.host);
  return server;
}

export async function checkHealthUrl(
  url: string,
  timeoutMs: number
): Promise<HealthCheckResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { status: "down", reason: "invalid_response" };
  }

  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: HealthCheckResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const request = client.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (response.statusCode !== 200) {
            finish({ status: "down", reason: "invalid_response" });
            return;
          }
          try {
            const parsed = JSON.parse(body) as { ok?: unknown };
            if (parsed.ok === true) {
              finish({ status: "up" });
              return;
            }
          } catch {
            finish({ status: "down", reason: "invalid_response" });
            return;
          }
          finish({ status: "down", reason: "invalid_response" });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      finish({ status: "down", reason: "timeout" });
    });

    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") {
        finish({ status: "down", reason: "connection_refused" });
        return;
      }
      if (error.code === "ETIMEDOUT") {
        finish({ status: "down", reason: "timeout" });
        return;
      }
      finish({ status: "down", reason: "invalid_response" });
    });

    request.end();
  });
}

export function startHealthChecker(
  serviceName: string,
  urls: string[],
  options: HealthCheckerOptions
): NodeJS.Timeout {
  if (urls.length === 0) {
    throw new Error("Health checker urls must not be empty");
  }

  const { intervalMs, timeoutMs } = options;
  const logger = createLogger("checker");
  const statusMap = new Map<string, HealthStatus>();

  const checkOnce = async (): Promise<void> => {
    const results = await Promise.all(
      urls.map((url) => checkHealthUrl(url, timeoutMs).then((result) => ({ url, result })))
    );

    for (const { url, result } of results) {
      const previous = statusMap.get(url);
      statusMap.set(url, result.status);
      if (previous === result.status) {
        continue;
      }
      if (result.status === "up") {
        logger.info(`${serviceName} status=up url=${url}`);
        continue;
      }
      const reason = result.reason ?? "invalid_response";
      logger.warn(`${serviceName} status=down url=${url} reason=${reason}`);
    }
  };

  void checkOnce();
  return setInterval(() => {
    void checkOnce();
  }, intervalMs);
}
