import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, requireGuildContext, requirePostgres, trimEmbedDescription } from "./command-utils";
import { getGuildSettings } from "./guild-settings-store";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Displays the server rules."),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const pool = requirePostgres(context, (options) => safeRespond(interaction, options));
    if (!pool) {
      return;
    }
    const settings = await getGuildSettings(pool, guildContext.guild.id);
    if (!settings.features.rules) {
      const embed = buildEmbed(context, {
        title: "Rules",
        description: "Rules are currently disabled for this server.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const entries = settings.rules.entries;
    if (!entries || entries.length === 0) {
      const embed = buildEmbed(context, {
        title: "Rules",
        description: "Rules have not been configured for this server.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const description = trimEmbedDescription(
      entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n")
    );
    const embed = buildEmbed(context, {
      title: "Rules",
      description
    });
    await safeRespond(interaction, { embeds: [embed] });
  }
};