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
    .setName("untimeout")
    .setDescription("Removes an active timeout from a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to remove timeout from").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for removing the timeout")
        .setRequired(false)
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
        description: "You do not have permission to remove timeouts.",
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
      "remove timeouts"
    );
    if (!botMember) {
      return;
    }
    const targetMember = interaction.options.getMember("user", true);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to remove timeout.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (targetMember.moderatable === false) {
      const embed = buildEmbed(context, {
        title: "Cannot Remove Timeout",
        description: "I cannot modify this member due to role hierarchy or permissions.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await targetMember.timeout(null, reason);
    } catch {
      const embed = buildEmbed(context, {
        title: "Untimeout Failed",
        description: "Unable to remove the timeout. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Untimeout",
      formatUserLabel(targetMember.user),
      reason
    );
    const embed = buildEmbed(context, {
      title: "Timeout Removed",
      description: `Removed timeout for ${formatUserLabel(targetMember.user)}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
