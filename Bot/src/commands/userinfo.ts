import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, fetchMemberSafe } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Shows information about a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to view").setRequired(false)
    ),
  execute: async (interaction, context) => {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = interaction.guild ? await fetchMemberSafe(interaction.guild, user.id) : null;
    const lines = [
      `User: <@${user.id}>`,
      `ID: ${user.id}`,
      user.createdAt ? `Created: ${user.createdAt.toISOString()}` : "Created: Unknown"
    ];
    if (member?.joinedAt) {
      lines.push(`Joined: ${member.joinedAt.toISOString()}`);
    }
    const embed = buildEmbed(context, {
      title: "User Info",
      description: lines.join("\n")
    });
    const avatar = user.displayAvatarURL({ size: 512 });
    embed.setThumbnail(avatar);
    await interaction.reply({ embeds: [embed] });
  }
};
