import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  fetchMemberSafe,
  formatUserLabel,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireGuildContext,
  requirePostgres,
  validateModerationTarget
} from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Removes a user from the server without banning them.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to kick").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the kick").setRequired(false)
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
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["KickMembers"],
      "kick members"
    );
    if (!botMember) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to kick.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to kick.",
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
      action: "kick",
      allowBotTargetWithAdmin: true
    });
    if (!allowed) {
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    await safeDefer(interaction);
    try {
      await targetMember.kick(reason);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Kick Failed",
        description: "Unable to kick that member. Please check my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Kick",
      formatUserLabel(targetMember.user),
      reason
    );
    const embed = buildEmbed(context, {
      title: "User Kicked",
      description: `Kicked ${formatUserLabel(targetMember.user)}.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed] });
  }
};
