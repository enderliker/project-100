import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildAdminrole } from "./storage";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setadminrole")
    .setDescription("Sets the admin role for this server.")
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to grant admin access").setRequired(true)
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
    const role = interaction.options.getRole("role", true);
    if (!role) {
      const embed = buildEmbed(context, {
        title: "Role Not Found",
        description: "Please specify a valid role to set as the admin role.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    await safeDefer(interaction, { ephemeral: true });
    await setGuildAdminrole(pool, guildContext.guild.id, role.id);
    const embed = buildEmbed(context, {
      title: "Admin Role Updated",
      description: `Admin role set to <@&${role.id}>.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
};
