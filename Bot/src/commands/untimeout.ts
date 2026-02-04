import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  fetchMemberSafe,
  formatUserLabel,
  hasModAccess,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireGuildContext,
  requireInvokerPermissions,
  requirePostgres,
  validateModerationTarget
} from "./command-utils";
import { getGuildConfig } from "./storage";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Removes an active timeout from a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to remove timeout from").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for removing the timeout")
        .setRequired(false)
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
        description: "You do not have permission to remove timeouts.",
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
      "remove timeouts"
    );
    if (!hasPermissions) {
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ModerateMembers"],
      "remove timeouts"
    );
    if (!botMember) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to remove timeout.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to remove timeout.",
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
      botMember,
      targetMember,
      action: "remove timeout from",
      allowBotTargetWithAdmin: true
    });
    if (!allowed) {
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    await safeDefer(interaction);
    try {
      await targetMember.timeout(null, reason);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Untimeout Failed",
        description: "Unable to remove the timeout. Please check my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Untimeout",
      formatUserLabel(targetMember.user),
      reason
    );
    const embed = buildEmbed(context, {
      title: "Timeout Removed",
      description: `Removed timeout for ${formatUserLabel(targetMember.user)}.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed] });
  }
};
