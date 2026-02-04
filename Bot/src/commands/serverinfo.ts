import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, requireGuildContext } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Shows information about this server."),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const guild = guildContext.guild;
    const description = [
      `Name: ${guild.name}`,
      `ID: ${guild.id}`,
      guild.ownerId ? `Owner: <@${guild.ownerId}>` : "Owner: Unknown",
      guild.memberCount !== undefined ? `Members: ${guild.memberCount}` : "Members: Unknown",
      guild.premiumTier ? `Boost Tier: ${guild.premiumTier}` : "Boost Tier: None",
      guild.premiumSubscriptionCount !== undefined
        ? `Boosts: ${guild.premiumSubscriptionCount}`
        : "Boosts: Unknown"
    ].join("\n");
    const embed = buildEmbed(context, {
      title: "Server Info",
      description
    });
    const iconUrl = guild.iconURL?.({ size: 512 }) ?? null;
    if (iconUrl) {
      embed.setThumbnail(iconUrl);
    }
    await safeRespond(interaction, { embeds: [embed] });
  }
};