import { SlashCommandBuilder } from "discord.js";
import type { TextBasedChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireChannelPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

type OverwriteCapableChannel = TextBasedChannel & {
  permissionOverwrites: {
    edit: (...args: unknown[]) => Promise<unknown>;
  };
};

function canEditOverwrites(
  channel: TextBasedChannel
): channel is OverwriteCapableChannel {
  return "permissionOverwrites" in channel;
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Locks a channel by denying SendMessages for @everyone.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to lock (defaults to current channel)")
        .setRequired(false)
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
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ManageChannels"],
      "lock channels"
    );
    if (!botMember) {
      return;
    }
    const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (
      !targetChannel ||
      !targetChannel.isTextBased() ||
      !canEditOverwrites(targetChannel)
    ) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const hasChannelPermissions = await requireChannelPermissions(
      interaction,
      context,
      targetChannel,
      botMember,
      ["ManageChannels"],
      "lock channels"
    );
    if (!hasChannelPermissions) {
      return;
    }
    await safeDefer(interaction);
    try {
      await targetChannel.permissionOverwrites.edit(
        guildContext.guild.roles.everyone,
        { SendMessages: false },
        "Channel locked"
      );
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Lock Failed",
        description: "Unable to lock that channel. Please check my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Lock",
      targetChannel.id,
      "Channel locked"
    );
    const embed = buildEmbed(context, {
      title: "Channel Locked",
      description: `Locked ${formatChannelLabel(targetChannel)}.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed] });
  }
};
