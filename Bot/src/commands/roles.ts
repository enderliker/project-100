import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, requireGuildContext } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription("Shows the total number of roles in this server."),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const roleCount = guildContext.guild.roles.cache.size;
    const embed = buildEmbed(context, {
      title: "Roles",
      description: `Total roles: ${roleCount}`
    });
    await safeRespond(interaction, { embeds: [embed] });
  }
};