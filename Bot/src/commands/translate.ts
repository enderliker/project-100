import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";
import { getGuildSettings } from "./guild-settings-store";
import { translateText } from "./translation";

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
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("source")
        .setDescription("Source language (leave blank for auto-detect)")
        .setRequired(false)
    ),
  execute: async (interaction, context) => {
    const text = interaction.options.getString("text", true).trim();
    const source = interaction.options.getString("source")?.trim() ?? null;
    let target = interaction.options.getString("target")?.trim() ?? null;
    if (context.postgresPool && interaction.guild) {
      const settings = await getGuildSettings(context.postgresPool, interaction.guild.id);
      if (!settings.translation.enabled) {
        const embed = buildEmbed(context, {
          title: "Translation Disabled",
          description: "Translation is disabled for this server.",
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      if (!target) {
        target = settings.translation.defaultTarget || settings.language;
      }
    }
    if (!target) {
      target = "en";
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await translateText({ text, source, target });
      const embed = buildEmbed(context, {
        title: "Translation",
        description: result.translatedText || "No translation result returned."
      });
      embed.addFields(
        { name: "Target", value: target, inline: true },
        { name: "Detected", value: result.detectedSource ?? "auto", inline: true }
      );
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const embed = buildEmbed(context, {
        title: "Translation Unavailable",
        description:
          "The translation service is currently unavailable. Please try again later or configure a custom provider.",
        variant: "warning"
      });
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
