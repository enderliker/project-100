import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("support").setDescription("Get support info."),
  execute: async (interaction, context) => {
    const supportUrl = "https://discord.gg/qtzDkhK2XV";
    const embed = buildEmbed(context, {
      title: "Support",
      description: supportUrl
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
