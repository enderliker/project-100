import http from "http";
import https from "https";
import { URL } from "url";

export type RemoteServiceStatus = "up" | "down";
export type RemoteServiceReason =
  | "timeout"
  | "connection_refused"
  | "invalid_response"
  | "invalid_url"
  | "http_error"
  | "network_error";

export interface RemoteServiceCheckResult {
  status: RemoteServiceStatus;
  reachable: boolean;
  statusCode?: number;
  latencyMs?: number;
  reason?: RemoteServiceReason;
}

export interface RemoteServiceCheckOptions {
  timeoutMs: number;
  retries: number;
}

export function normalizeStatusCheckOptions(
  options?: Partial<RemoteServiceCheckOptions>
): RemoteServiceCheckOptions {
  const timeoutMs = options?.timeoutMs ?? 1500;
  const retries = Math.max(1, options?.retries ?? 1);
  return { timeoutMs, retries };
}

function resolveReason(error: NodeJS.ErrnoException): RemoteServiceReason {
  if (error.code === "ECONNREFUSED") {
    return "connection_refused";
  }
  if (error.code === "ETIMEDOUT") {
    return "timeout";
  }
  return "network_error";
}

async function attemptRemoteCheck(
  url: string,
  timeoutMs: number
): Promise<RemoteServiceCheckResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { status: "down", reachable: false, reason: "invalid_url" };
  }

  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    const start = Date.now();

    const finish = (result: RemoteServiceCheckResult): void => {
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
          const latencyMs = Date.now() - start;
          const statusCode = response.statusCode ?? 0;
          if (statusCode !== 200) {
            finish({
              status: "down",
              reachable: true,
              statusCode,
              latencyMs,
              reason: "http_error"
            });
            return;
          }

          const body = Buffer.concat(chunks).toString("utf-8");
          try {
            const parsed = JSON.parse(body) as { ok?: unknown };
            if (parsed.ok === true) {
              finish({
                status: "up",
                reachable: true,
                statusCode,
                latencyMs
              });
              return;
            }
          } catch {
            finish({
              status: "down",
              reachable: true,
              statusCode,
              latencyMs,
              reason: "invalid_response"
            });
            return;
          }

          finish({
            status: "down",
            reachable: true,
            statusCode,
            latencyMs,
            reason: "invalid_response"
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      finish({
        status: "down",
        reachable: false,
        latencyMs: Date.now() - start,
        reason: "timeout"
      });
    });

    request.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        status: "down",
        reachable: false,
        latencyMs: Date.now() - start,
        reason: resolveReason(error)
      });
    });

    request.end();
  });
}

export async function checkRemoteService(
  url: string,
  options: RemoteServiceCheckOptions
): Promise<RemoteServiceCheckResult> {
  let lastResult: RemoteServiceCheckResult = {
    status: "down",
    reachable: false,
    reason: "invalid_response"
  };

  for (let attempt = 0; attempt < options.retries; attempt += 1) {
    const result = await attemptRemoteCheck(url, options.timeoutMs);
    if (result.reason === "invalid_url") {
      return result;
    }
    lastResult = result;
    if (result.status === "up") {
      return result;
    }
  }

  return lastResult;
}
