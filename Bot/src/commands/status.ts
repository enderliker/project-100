import { SlashCommandBuilder } from "discord.js";
import { checkPostgresHealth, checkRedisHealth } from "@project/shared";
import { buildStatusEmbed, fetchStatusSnapshot } from "../status";
import type { CommandDefinition } from "./types";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show service status"),
  execute: async (interaction, context) => {
    const snapshot = await fetchStatusSnapshot({
      workerUrl: context.workerHealthUrl ?? undefined,
      timeoutMs: context.statusCheckTimeoutMs,
      retries: context.statusCheckRetries
    });

    const redisHealth = await checkRedisHealth(context.redis, context.statusCheckTimeoutMs);
    const postgresHealth = context.postgresPool
      ? await checkPostgresHealth(context.postgresPool, context.statusCheckTimeoutMs)
      : null;

    const version = context.getVersion();
    const embed = buildStatusEmbed(
      { serviceName: "bot", version },
      {
        serviceMode: context.serviceMode,
        uptimeSeconds: process.uptime(),
        redisConnected: redisHealth.ok,
        postgresConnected: postgresHealth ? postgresHealth.ok : null,
        version
      },
      snapshot
    );
    await safeRespond(interaction, { embeds: [embed] });
  }
};
