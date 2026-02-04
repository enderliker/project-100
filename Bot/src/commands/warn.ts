import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  fetchMemberSafe,
  formatUserLabel,
  handleCommandError,
  logModerationAction,
  requireGuildContext,
  requirePostgres,
  validateModerationTarget
} from "./command-utils";
import { createWarning } from "./storage";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Creates a persistent moderation warning for a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to warn").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the warning").setRequired(false)
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
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to warn.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to warn.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const allowed = await validateModerationTarget({
      interaction,
      context,
      guild: guildContext.guild,
      invoker: guildContext.member,
      botMember: null,
      targetMember,
      action: "warn",
      allowBotTargetWithAdmin: true
    });
    if (!allowed) {
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    await safeDefer(interaction);
    try {
      await createWarning(pool, guildContext.guild.id, target.id, guildContext.member.id, reason);
      await logModerationAction(
        context,
        guildContext.guild,
        guildContext.member.id,
        "Warn",
        formatUserLabel(target),
        reason
      );
      const embed = buildEmbed(context, {
        title: "Warning Issued",
        description: `Warned ${formatUserLabel(target)}.`
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed] });
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Warn Failed",
        description: "Unable to issue that warning. Please try again."
      });
    }
  }
};
