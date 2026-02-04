import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

function getInviteUrl(): string | null {
  const appId = process.env.DISCORD_APP_ID;
  if (!appId || !/^\d+$/.test(appId)) {
    return null;
  }
  return `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=0&scope=bot%20applications.commands`;
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("invite").setDescription("Get the bot invite link."),
  execute: async (interaction, context) => {
    const inviteUrl = getInviteUrl();
    if (!inviteUrl) {
      const embed = buildEmbed(context, {
        title: "Invite",
        description: "Invite link is not configured.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const embed = buildEmbed(context, {
      title: "Invite",
      description: inviteUrl
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
