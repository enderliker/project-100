import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  handleCommandError,
  requireBotPermissions,
  requireChannelPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

const MAX_SAY_LENGTH = 2000;

type SayValidationResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export function validateSayMessage(raw: string): SayValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Message cannot be empty or whitespace." };
  }
  if (trimmed.length > MAX_SAY_LENGTH) {
    return {
      ok: false,
      error: `Message must be ${MAX_SAY_LENGTH} characters or fewer.`
    };
  }
  return { ok: true, message: trimmed };
}

export function buildSayPayload(message: string) {
  return {
    content: message,
    allowedMentions: { parse: [] as const }
  };
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message as the bot.")
    .addStringOption((option) =>
      option.setName("message").setDescription("Message to send").setRequired(true)
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
      ["SendMessages"],
      "send messages"
    );
    if (!botMember) {
      return;
    }
    const messageInput = interaction.options.getString("message", true);
    if (messageInput === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Message",
        description: "Please provide a valid message to send.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const validation = validateSayMessage(messageInput);
    if (!validation.ok) {
      const embed = buildEmbed(context, {
        title: "Invalid Message",
        description: validation.error,
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const hasChannelPermissions = await requireChannelPermissions(
      interaction,
      context,
      channel,
      botMember,
      ["SendMessages"],
      "send messages"
    );
    if (!hasChannelPermissions) {
      return;
    }
    await safeDefer(interaction, { ephemeral: true });
    try {
      await channel.send(buildSayPayload(validation.message));
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Message Failed",
        description: "Unable to send that message. Please check my permissions."
      });
      return;
    }
    const embed = buildEmbed(context, {
      title: "Message Sent",
      description: "Your message has been sent."
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
};
