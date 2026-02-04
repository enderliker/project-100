import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildGoodbyeTemplate } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setgoodbye")
    .setDescription("Sets the goodbye message template.")
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("Goodbye message template")
        .setMinLength(1)
        .setMaxLength(1900)
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
    const template = interaction.options.getString("template", true);
    await setGuildGoodbyeTemplate(pool, guildContext.guild.id, template);
    const embed = buildEmbed(context, {
      title: "Goodbye Template Updated",
      description: "Goodbye template saved."
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
