import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("translate")
    .setDescription("Translates text between languages.")
    .addStringOption((option) =>
      option.setName("text").setDescription("Text to translate").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("target")
        .setDescription("Target language (e.g. en, es)")
        .setRequired(true)
    ),
  execute: async (interaction, context) => {
    const embed = buildEmbed(context, {
      title: "Translate",
      description: "Translation is not configured for this bot.",
      variant: "warning"
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
