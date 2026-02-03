import { SlashCommandBuilder } from "discord.js";
import { buildStatusEmbed, fetchStatusSnapshot } from "../status";
import type { CommandDefinition } from "./types";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("status").setDescription("Show service status"),
  execute: async (interaction, context) => {
    const snapshot = await fetchStatusSnapshot({
      workerUrl: context.workerHealthUrl,
      worker2Url: context.worker2HealthUrl,
      timeoutMs: context.statusCheckTimeoutMs,
      retries: context.statusCheckRetries
    });

    const redisConnected = await context.redisConnected();
    const postgresConnected = await context.postgresConnected();

    const embed = buildStatusEmbed(
      { serviceName: "bot", version: context.version },
      {
        serviceMode: context.serviceMode,
        uptimeSeconds: context.uptimeSeconds(),
        redisConnected,
        postgresConnected,
        version: context.version
      },
      snapshot
    );

    await interaction.reply({ embeds: [embed.toJSON()] });
  }
};
