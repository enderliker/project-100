import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("botinfo").setDescription("Shows bot info."),
  execute: async (interaction, context) => {
    const version = context.getVersion();
    const uptime = Math.round(process.uptime());
    const embed = buildEmbed(context, {
      title: "Bot Info",
      description: `Version: ${version}\nUptime: ${uptime}s`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
