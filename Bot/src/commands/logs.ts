import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasModAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, listModlogs } from "./storage";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const EMBED_DESCRIPTION_LIMIT = 4000;

function trimDescription(value: string): string {
  if (value.length <= EMBED_DESCRIPTION_LIMIT) {
    return value;
  }
  return `${value.slice(0, EMBED_DESCRIPTION_LIMIT - 3)}...`;
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Displays recent moderation actions.")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of entries to display (max 25)")
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
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
        description: "You do not have permission to view moderation logs.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    const entries = await listModlogs(pool, guildContext.guild.id, limit);
    const description =
      entries.length === 0
        ? "No moderation actions have been logged."
        : entries
            .map(
              (entry) =>
                `${entry.createdAt.toISOString()} • ${entry.action} • ${entry.target} • ${entry.reason}`
            )
            .join("\n");
    const embed = buildEmbed(context, {
      title: "Moderation Logs",
      description: trimDescription(description)
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
