import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, requireGuildContext } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("members")
    .setDescription("Shows the member count for this server."),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const count = guildContext.guild.memberCount ?? 0;
    const embed = buildEmbed(context, {
      title: "Members",
      description: `Total members: ${count}`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
