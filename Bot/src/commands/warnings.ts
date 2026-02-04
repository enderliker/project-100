import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  hasModAccess,
  handleCommandError,
  requireGuildContext,
  requireInvokerPermissions,
  requirePostgres,
  trimEmbedDescription
} from "./command-utils";
import { getGuildConfig, listWarnings } from "./storage";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Displays all stored warnings for a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to review").setRequired(true)
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
    if (!hasModAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to view warnings.",
        variant: "error"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const hasPermissions = await requireInvokerPermissions(
      interaction,
      context,
      guildContext.member,
      ["ModerateMembers"],
      "view warnings"
    );
    if (!hasPermissions) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to view warnings.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    await safeDefer(interaction);
    try {
      const warnings = await listWarnings(pool, guildContext.guild.id, target.id);
      if (warnings.length === 0) {
        const embed = buildEmbed(context, {
          title: "Warnings",
          description: `${formatUserLabel(target)} has no warnings.`
        });
        await safeEditOrFollowUp(interaction, { embeds: [embed] });
        return;
      }
      const lines = warnings.map(
        (warning) =>
          `${warning.createdAt.toISOString()} • ${warning.reason} • Moderator: <@${warning.moderatorId}>`
      );
      const embed = buildEmbed(context, {
        title: "Warnings",
        description: trimEmbedDescription(lines.join("\n"))
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed] });
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Warnings Failed",
        description: "Unable to load warnings right now."
      });
    }
  }
};
