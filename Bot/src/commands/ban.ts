import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  fetchMemberSafe,
  formatUserLabel,
  hasModAccess,
  hasAdministratorPermission,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireGuildContext,
  requireInvokerPermissions,
  requirePostgres,
  validateModerationTarget
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
    const hasPermissions = await requireInvokerPermissions(
      interaction,
      context,
      guildContext.member,
      ["BanMembers"],
      "ban members"
    );
    if (!hasPermissions) {
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
    if (target.id === guildContext.guild.ownerId) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot ban the server owner.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (target.bot && !hasAdministratorPermission(guildContext.member)) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You need Administrator to ban bot accounts.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (targetMember) {
      const allowed = await validateModerationTarget({
        interaction,
        context,
        guild: guildContext.guild,
        invoker: guildContext.member,
        botMember,
        targetMember,
        action: "ban",
        allowBotTargetWithAdmin: true
      });
      if (!allowed) {
        return;
      }
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await guildContext.guild.members.ban(target, { reason });
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Ban Failed",
        description: "Unable to ban that user. Please check my permissions."
      });
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
