import http from "http";

export type HealthCheck = () => Promise<boolean> | boolean;

interface HealthServerOptions {
  port: number;
  host?: string;
  checks: Record<string, HealthCheck>;
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

  server.listen(options.port, options.host ?? "0.0.0.0");
  return server;
}
