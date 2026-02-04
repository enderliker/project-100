import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  hasModAccess,
  logModerationAction,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bans a user using Discord’s native ban system.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to ban").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the ban").setRequired(false)
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
        description: "You do not have permission to ban members.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "Invalid User",
        description: "Please select a valid user to ban.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    await guildContext.guild.members.ban(target, { reason });
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Ban",
      formatUserLabel(target),
      reason
    );
    const embed = buildEmbed(context, {
      title: "User Banned",
      description: `Banned ${formatUserLabel(target)}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
