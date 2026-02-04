import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  hasModAccess,
  logModerationAction,
  requireBotPermissions,
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
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["BanMembers"],
      "ban members"
    );
    if (!botMember) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to ban.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (target.id === interaction.user.id) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot ban yourself.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (context.client.user && target.id === context.client.user.id) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot ban the bot.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await guildContext.guild.members
      .fetch(target.id)
      .catch(() => null);
    if (targetMember && targetMember.bannable === false) {
      const embed = buildEmbed(context, {
        title: "Cannot Ban Member",
        description: "I cannot ban this member due to role hierarchy or permissions.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await guildContext.guild.members.ban(target, { reason });
    } catch {
      const embed = buildEmbed(context, {
        title: "Ban Failed",
        description: "Unable to ban that user. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
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
