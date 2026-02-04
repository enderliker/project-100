import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildToggle } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("toggle")
    .setDescription("Toggles a server feature on or off.")
    .addStringOption((option) =>
      option
        .setName("feature")
        .setDescription("Feature to toggle")
        .setMinLength(1)
        .setMaxLength(50)
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option.setName("enabled").setDescription("Enable or disable").setRequired(true)
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
    if (!hasAdminAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to update server configuration.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const featureValue = interaction.options.getString("feature", true);
    if (!featureValue) {
      const embed = buildEmbed(context, {
        title: "Missing Feature",
        description: "Please provide a valid feature name to toggle.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const feature = featureValue.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(feature)) {
      const embed = buildEmbed(context, {
        title: "Invalid Feature",
        description: "Feature names must use only letters, numbers, underscores, or dashes.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const enabled = interaction.options.getBoolean("enabled", true);
    if (enabled === null) {
      const embed = buildEmbed(context, {
        title: "Missing Toggle Value",
        description: "Please specify whether the feature should be enabled or disabled.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await setGuildToggle(pool, guildContext.guild.id, feature, enabled);
    await context.redis.del(`counter:${guildContext.guild.id}:${feature}`);
    const embed = buildEmbed(context, {
      title: "Toggle Updated",
      description: `Feature \`${feature}\` is now ${enabled ? "enabled" : "disabled"}.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
