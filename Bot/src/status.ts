import { EmbedBuilder } from "@discordjs/builders";
import {
  RemoteServiceCheckResult,
  RemoteServiceCheckOptions,
  checkRemoteService
} from "@project/shared";

export interface StatusCheckConfig {
  workerUrl?: string;
  worker2Url?: string;
  timeoutMs: number;
  retries: number;
}

export interface StatusDependencies {
  serviceMode: string;
  uptimeSeconds: number;
  redisConnected: boolean;
  version: string;
}

export interface StatusSnapshot {
  worker?: RemoteServiceCheckResult;
  worker2?: RemoteServiceCheckResult;
}

export async function fetchStatusSnapshot(
  config: StatusCheckConfig
): Promise<StatusSnapshot> {
  const options: RemoteServiceCheckOptions = {
    timeoutMs: config.timeoutMs,
    retries: config.retries
  };

  const workerPromise = config.workerUrl
    ? checkRemoteService(config.workerUrl, options)
    : Promise.resolve(undefined);
  const worker2Promise = config.worker2Url
    ? checkRemoteService(config.worker2Url, options)
    : Promise.resolve(undefined);
  const [worker, worker2] = await Promise.all([workerPromise, worker2Promise]);

  return { worker, worker2 };
}

function formatLatency(result?: RemoteServiceCheckResult): string {
  if (!result || result.latencyMs === undefined) {
    return "";
  }
  return `${Math.round(result.latencyMs)}ms`;
}

function formatReason(result?: RemoteServiceCheckResult): string {
  if (!result) {
    return "not configured";
  }
  if (result.status === "up") {
    const latency = formatLatency(result);
    return latency ? `ok (\`${latency}\`)` : "ok";
  }
  const latency = formatLatency(result);
  const reason = result.reason ?? "unreachable";
  return latency ? `${reason} (\`${latency}\`)` : reason;
}

function formatServiceValue(result?: RemoteServiceCheckResult): string {
  if (!result) {
    return "`down` (not configured)";
  }
  const status = result.status === "up" ? "`up`" : "`down`";
  const reason = formatReason(result);
  return `${status} — ${reason}`;
}

function formatUptime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

export function buildStatusEmbed(
  deps: StatusDependencies,
  snapshot: StatusSnapshot
): EmbedBuilder {
  const uptime = formatUptime(deps.uptimeSeconds);
  const embed = new EmbedBuilder()
    .setTitle("Service Status")
    .setColor(0x2f3136)
    .setFields([
      {
        name: "Bot",
        value: `\`up\` • uptime \`${uptime}\` • version \`${deps.version}\`\nmode \`${deps.serviceMode}\``,
        inline: false
      },
      {
        name: "Worker",
        value: formatServiceValue(snapshot.worker),
        inline: false
      },
      {
        name: "Worker2",
        value: formatServiceValue(snapshot.worker2),
        inline: false
      },
      {
        name: "Redis",
        value: deps.redisConnected ? "`up`" : "`down`",
        inline: false
      }
    ])
    .setFooter({ text: `Last checked: ${new Date().toISOString()}` });

  return embed;
}
