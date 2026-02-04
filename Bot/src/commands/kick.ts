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
    .setName("kick")
    .setDescription("Removes a user from the server without banning them.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to kick").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the kick").setRequired(false)
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
        description: "You do not have permission to kick members.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["KickMembers"],
      "kick members"
    );
    if (!botMember) {
      return;
    }
    const targetMember = interaction.options.getMember("user", true);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to kick.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (targetMember.id === interaction.user.id) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot kick yourself.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (context.client.user && targetMember.id === context.client.user.id) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot kick the bot.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (targetMember.kickable === false) {
      const embed = buildEmbed(context, {
        title: "Cannot Kick Member",
        description: "I cannot kick this member due to role hierarchy or permissions.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await targetMember.kick(reason);
    } catch {
      const embed = buildEmbed(context, {
        title: "Kick Failed",
        description: "Unable to kick that member. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Kick",
      formatUserLabel(targetMember.user),
      reason
    );
    const embed = buildEmbed(context, {
      title: "User Kicked",
      description: `Kicked ${formatUserLabel(targetMember.user)}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
