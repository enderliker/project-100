import { SlashCommandBuilder } from "discord.js";
import { buildBaseEmbed } from "../embeds";
import type { CommandDefinition } from "./types";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),
  execute: async (interaction, context) => {
    const latency = Date.now() - interaction.createdTimestamp;
    const wsLatency = context.client.ws.ping;
    const uptimeSeconds = process.uptime();
    const version = context.getVersion();
    const embed = buildBaseEmbed(
      { serviceName: "bot", version },
      {
        title: "Pong",
        description: `ws \`${wsLatency}ms\` • api \`${latency}ms\` • up \`${Math.round(
          uptimeSeconds
        )}s\``
      }
    );
    await safeRespond(interaction, { embeds: [embed] });
  }
};