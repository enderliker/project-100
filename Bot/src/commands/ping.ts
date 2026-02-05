import { SlashCommandBuilder } from "discord.js";
import { buildBaseEmbed } from "../embeds";
import type { CommandDefinition } from "./types";
import { safeDefer, safeEditOrFollowUp } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),
  execute: async (interaction, context) => {
    const deferStart = Date.now();
    await safeDefer(interaction);
    const apiLatency = Date.now() - deferStart;
    const ageMs = Date.now() - interaction.createdTimestamp;
    const wsLatency = context.client.ws.ping;
    const uptimeSeconds = process.uptime();
    const version = context.getVersion();
    const uptime = formatUptime(uptimeSeconds);
    const embed = buildBaseEmbed(
      { serviceName: "bot", version },
      {
        title: "Pong",
        description: `ws \`${wsLatency}ms\` • api \`${apiLatency}ms\` • age \`${ageMs}ms\` • up \`${uptime}\``
      }
    );
    await safeEditOrFollowUp(interaction, { embeds: [embed] });
  }
};

function formatUptime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const days = Math.floor(rounded / 86400);
  const hours = Math.floor((rounded % 86400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${secs}s`;
}
