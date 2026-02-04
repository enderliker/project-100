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
import { createReport, getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Sends and stores a user report.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to report").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the report").setRequired(true)
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
        description: "You do not have permission to submit reports.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "Invalid User",
        description: "Please select a valid user to report.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason", true);
    if (!reason) {
      const embed = buildEmbed(context, {
        title: "Invalid Reason",
        description: "Please provide a valid reason.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await createReport(pool, guildContext.guild.id, interaction.user.id, target.id, reason);
    await logModerationAction(
      context,
      guildContext.guild,
      interaction.user.id,
      "Report",
      formatUserLabel(target),
      reason
    );
    const embed = buildEmbed(context, {
      title: "Report Submitted",
      description: `Your report for ${formatUserLabel(target)} has been submitted.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
