import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  handleCommandError,
  hasModAccess,
  logModerationAction,
  requireBotPermissions,
  requireGuildContext,
  requireInvokerPermissions,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Removes an existing ban by Discord user ID.")
    .addStringOption((option) =>
      option.setName("user_id").setDescription("User ID to unban").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the unban").setRequired(false)
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
        description: "You do not have permission to unban members.",
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
      "unban members"
    );
    if (!hasPermissions) {
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["BanMembers"],
      "unban members"
    );
    if (!botMember) {
      return;
    }
    const userId = interaction.options.getString("user_id", true);
    if (!userId) {
      const embed = buildEmbed(context, {
        title: "User ID Required",
        description: "Please provide a valid user ID to unban.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    try {
      await guildContext.guild.bans.remove(userId, reason);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Unban Failed",
        description: "Unable to unban that user. Please check the ID and my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Unban",
      userId,
      reason
    );
    const embed = buildEmbed(context, {
      title: "User Unbanned",
      description: `Unbanned user ID ${userId}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
