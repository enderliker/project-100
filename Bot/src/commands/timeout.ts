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

const MAX_TIMEOUT_SECONDS = 60 * 60 * 24 * 28;

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Applies a Discord-native timeout to a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to timeout").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Timeout duration in seconds")
        .setMinValue(1)
        .setMaxValue(MAX_TIMEOUT_SECONDS)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the timeout").setRequired(false)
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
        description: "You do not have permission to timeout members.",
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
      "timeout members"
    );
    if (!hasPermissions) {
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ModerateMembers"],
      "timeout members"
    );
    if (!botMember) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to timeout.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to timeout.",
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
      action: "timeout",
      allowBotTargetWithAdmin: true
    });
    if (!allowed) {
      return;
    }
    const durationSeconds = interaction.options.getInteger("duration", true);
    if (durationSeconds === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Duration",
        description: "Please provide a valid timeout duration.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    await safeDefer(interaction);
    try {
      await targetMember.timeout(durationSeconds * 1000, reason);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Timeout Failed",
        description: "Unable to timeout that member. Please check my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Timeout",
      formatUserLabel(targetMember.user),
      `${reason} (duration: ${durationSeconds}s)`
    );
    const embed = buildEmbed(context, {
      title: "User Timed Out",
      description: `Timed out ${formatUserLabel(targetMember.user)} for ${durationSeconds}s.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed] });
  }
};
