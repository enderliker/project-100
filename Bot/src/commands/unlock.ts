import { SlashCommandBuilder } from "discord.js";
import type { TextBasedChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  hasModAccess,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireChannelPermissions,
  requireGuildContext,
  requireInvokerPermissions,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

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
    .setName("unlock")
    .setDescription("Unlocks a previously locked channel.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to unlock (defaults to current channel)")
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
        description: "You do not have permission to unlock channels.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const hasPermissions = await requireInvokerPermissions(
      interaction,
      context,
      guildContext.member,
      ["ManageChannels"],
      "unlock channels"
    );
    if (!hasPermissions) {
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ManageChannels"],
      "unlock channels"
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
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const hasChannelPermissions = await requireChannelPermissions(
      interaction,
      context,
      targetChannel,
      botMember,
      ["ManageChannels"],
      "unlock channels"
    );
    if (!hasChannelPermissions) {
      return;
    }
    try {
      await targetChannel.permissionOverwrites.edit(
        guildContext.guild.roles.everyone,
        { SendMessages: true },
        "Channel unlocked"
      );
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Unlock Failed",
        description: "Unable to unlock that channel. Please check my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Unlock",
      targetChannel.id,
      "Channel unlocked"
    );
    const embed = buildEmbed(context, {
      title: "Channel Unlocked",
      description: `Unlocked ${formatChannelLabel(targetChannel)}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
