import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  hasModAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, listWarnings } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Displays all stored warnings for a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to review").setRequired(true)
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
    if (!hasModAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to view warnings.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const target = interaction.options.getUser("user", true);
    const warnings = await listWarnings(pool, guildContext.guild.id, target.id);
    if (warnings.length === 0) {
      const embed = buildEmbed(context, {
        title: "Warnings",
        description: `${formatUserLabel(target)} has no warnings.`
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }
    const lines = warnings.map(
      (warning) =>
        `${warning.createdAt.toISOString()} • ${warning.reason} • Moderator: <@${warning.moderatorId}>`
    );
    const embed = buildEmbed(context, {
      title: "Warnings",
      description: lines.join("\n")
    });
    await interaction.reply({ embeds: [embed] });
  }
};
