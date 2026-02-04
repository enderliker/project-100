import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";
import {
  clearGuildSettingsCache,
  updateGuildSettings
} from "./guild-settings-store";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setlanguage")
    .setDescription("Sets the default language for this server.")
    .addStringOption((option) =>
      option
        .setName("language")
        .setDescription("Language code (e.g. en, es, fr)")
        .setMinLength(2)
        .setMaxLength(10)
        .setRequired(true)
    ),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const pool = requirePostgres(context, (options) => interaction.reply(options));
    if (!pool) {
      return;
    }
    const config = await getGuildConfig(pool, guildContext.guild.id);
    if (!hasAdminAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to update server configuration.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const language = interaction.options.getString("language", true).trim().toLowerCase();
    await updateGuildSettings(pool, guildContext.guild.id, {
      language,
      translation: {
        defaultTarget: language
      }
    });
    clearGuildSettingsCache(guildContext.guild.id);
    const embed = buildEmbed(context, {
      title: "Language Updated",
      description: `Default language set to **${language}**.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
