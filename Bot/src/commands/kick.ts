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
    const targetMember = interaction.options.getMember("user", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    await targetMember.kick(reason);
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
