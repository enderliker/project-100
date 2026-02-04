import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("support").setDescription("Get support info."),
  execute: async (interaction, context) => {
    const supportUrl = process.env.SUPPORT_URL;
    if (!supportUrl) {
      const embed = buildEmbed(context, {
        title: "Support",
        description: "Support link is not configured.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const embed = buildEmbed(context, {
      title: "Support",
      description: supportUrl
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
