import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),
  execute: async (interaction, context) => {
    const latency = Date.now() - interaction.createdTimestamp;
    const wsLatency = context.client.ws.ping;
    const uptimeSeconds = process.uptime();
    const message = `Pong • ws \`${wsLatency}ms\` • api \`${latency}ms\` • uptime \`${Math.round(
      uptimeSeconds
    )}s\``;
    await interaction.reply({ content: message });
  }
};
