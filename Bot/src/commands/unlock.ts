import { SlashCommandBuilder, type TextChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  hasModAccess,
  logModerationAction,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

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
    const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (
      !targetChannel ||
      !targetChannel.isTextBased() ||
      !("permissionOverwrites" in targetChannel)
    ) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await (targetChannel as TextChannel).permissionOverwrites.edit(
      guildContext.guild.roles.everyone,
      { SendMessages: true },
      "Channel unlocked"
    );
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
