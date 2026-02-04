import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildPrefix } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setprefix")
    .setDescription("Sets the command prefix for this server.")
    .addStringOption((option) =>
      option
        .setName("prefix")
        .setDescription("Prefix to use")
        .setMinLength(1)
        .setMaxLength(5)
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
    const rawPrefix = interaction.options.getString("prefix", true);
    if (!rawPrefix) {
      const embed = buildEmbed(context, {
        title: "Invalid Prefix",
        description: "Please provide a valid prefix.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const prefix = rawPrefix.trim();
    await setGuildPrefix(pool, guildContext.guild.id, prefix);
    const embed = buildEmbed(context, {
      title: "Prefix Updated",
      description: `Prefix set to \`${prefix}\`.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
