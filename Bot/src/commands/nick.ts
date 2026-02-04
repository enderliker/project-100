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
    .setName("nick")
    .setDescription("Changes a member’s nickname.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to update").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription("New nickname (leave empty to reset)")
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
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ManageNicknames"],
      "change nicknames"
    );
    if (!botMember) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to update.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const targetMember = await fetchMemberSafe(guildContext.guild, target.id);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to update.",
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
      action: "change the nickname for",
      allowBotTargetWithAdmin: true
    });
    if (!allowed) {
      return;
    }
    const nickname = interaction.options.getString("nickname");
    await safeDefer(interaction);
    try {
      await targetMember.setNickname(nickname ?? null, "Nickname update");
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Nickname Update Failed",
        description: "Unable to update that nickname. Please check my permissions."
      });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Nick",
      formatUserLabel(targetMember.user),
      nickname ?? "Nickname cleared"
    );
    const embed = buildEmbed(context, {
      title: "Nickname Updated",
      description: `Updated nickname for ${formatUserLabel(targetMember.user)}.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed] });
  }
};
