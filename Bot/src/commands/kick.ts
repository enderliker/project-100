import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  fetchMemberSafe,
  formatUserLabel,
  hasModAccess,
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
    const hasPermissions = await requireInvokerPermissions(
      interaction,
      context,
      guildContext.member,
      ["KickMembers"],
      "kick members"
    );
    if (!hasPermissions) {
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
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to kick.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to kick.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const allowed = await validateModerationTarget({
      interaction,
      context,
      guild: guildContext.guild,
      invoker: guildContext.member,
      botMember,
      targetMember,
      action: "kick",
      allowBotTargetWithAdmin: true
    });
    if (!allowed) {
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await targetMember.kick(reason);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Kick Failed",
        description: "Unable to kick that member. Please check my permissions."
      });
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
