import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasModAccess,
  logModerationAction,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

const MAX_SLOWMODE = 21600;

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Sets or disables slow mode for a text channel.")
    .addIntegerOption((option) =>
      option
        .setName("seconds")
        .setDescription("Slowmode duration in seconds (0 to disable)")
        .setMinValue(0)
        .setMaxValue(MAX_SLOWMODE)
        .setRequired(true)
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
        description: "You do not have permission to manage slowmode.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const seconds = interaction.options.getInteger("seconds", true);
    await (channel as any).setRateLimitPerUser(seconds, "Slowmode update");
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Slowmode",
      channel.id,
      `Set to ${seconds}s`
    );
    const embed = buildEmbed(context, {
      title: "Slowmode Updated",
      description: seconds === 0 ? "Slowmode disabled." : `Slowmode set to ${seconds}s.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
