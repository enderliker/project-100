import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, requireGuildContext, requirePostgres } from "./command-utils";
import { getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Displays the server rules."),
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
    const rulesText = config?.rulesText;
    if (!rulesText) {
      const embed = buildEmbed(context, {
        title: "Rules",
        description: "Rules have not been configured for this server.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const embed = buildEmbed(context, {
      title: "Rules",
      description: rulesText
    });
    await interaction.reply({ embeds: [embed] });
  }
};
