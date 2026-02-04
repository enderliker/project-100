import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildWelcomeTemplate } from "./storage";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Sets the welcome message template.")
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("Welcome message template")
        .setMinLength(1)
        .setMaxLength(1900)
        .setRequired(true)
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
    const template = interaction.options.getString("template", true);
    await safeDefer(interaction, { ephemeral: true });
    await setGuildWelcomeTemplate(pool, guildContext.guild.id, template);
    const embed = buildEmbed(context, {
      title: "Welcome Template Updated",
      description: "Welcome template saved."
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
};
