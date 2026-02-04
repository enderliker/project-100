import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildAutorole } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setautorole")
    .setDescription("Sets the autorole for new members.")
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to assign").setRequired(true)
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
    if (!hasAdminAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to update server configuration.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const role = interaction.options.getRole("role", true);
    if (!role) {
      const embed = buildEmbed(context, {
        title: "Invalid Role",
        description: "Please select a valid role.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await setGuildAutorole(pool, guildContext.guild.id, role.id);
    const embed = buildEmbed(context, {
      title: "Autorole Updated",
      description: `Autorole set to <@&${role.id}>.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
