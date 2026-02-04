import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildLogsChannel } from "./storage";
import { clearGuildSettingsCache, updateGuildSettings } from "./guild-settings-store";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Sets the logs channel for moderation actions.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to receive moderation logs")
        .setRequired(true)
    ),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const pool = requirePostgres(context, (options) => safeRespond(interaction, options));
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
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    if (!channel) {
      const embed = buildEmbed(context, {
        title: "Channel Not Found",
        description: "Please specify a valid channel for moderation logs.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    await safeDefer(interaction, { ephemeral: true });
    await setGuildLogsChannel(pool, guildContext.guild.id, channel.id);
    await updateGuildSettings(pool, guildContext.guild.id, {
      loggingChannelId: channel.id
    });
    clearGuildSettingsCache(guildContext.guild.id);
    const embed = buildEmbed(context, {
      title: "Logs Channel Updated",
      description: `Logs channel set to ${formatChannelLabel(channel)}.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
};
