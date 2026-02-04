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

const MAX_TIMEOUT_SECONDS = 60 * 60 * 24 * 28;

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Applies a Discord-native timeout to a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to timeout").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Timeout duration in seconds")
        .setMinValue(1)
        .setMaxValue(MAX_TIMEOUT_SECONDS)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the timeout").setRequired(false)
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
        description: "You do not have permission to timeout members.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ModerateMembers"],
      "timeout members"
    );
    if (!botMember) {
      return;
    }
    const targetMember = interaction.options.getMember("user", true);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to timeout.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (targetMember.id === interaction.user.id) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot timeout yourself.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (context.client.user && targetMember.id === context.client.user.id) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: "You cannot timeout the bot.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (targetMember.moderatable === false) {
      const embed = buildEmbed(context, {
        title: "Cannot Timeout Member",
        description: "I cannot timeout this member due to role hierarchy or permissions.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const durationSeconds = interaction.options.getInteger("duration", true);
    if (durationSeconds === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Duration",
        description: "Please provide a valid timeout duration.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await targetMember.timeout(durationSeconds * 1000, reason);
    } catch {
      const embed = buildEmbed(context, {
        title: "Timeout Failed",
        description: "Unable to timeout that member. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Timeout",
      formatUserLabel(targetMember.user),
      `${reason} (duration: ${durationSeconds}s)`
    );
    const embed = buildEmbed(context, {
      title: "User Timed Out",
      description: `Timed out ${formatUserLabel(targetMember.user)} for ${durationSeconds}s.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
