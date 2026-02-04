import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  InteractionDeferReplyOptions,
  InteractionReplyOptions,
  MessagePayload,
  User
} from "discord.js";
import { createLogger } from "@project/shared";
import type { CommandExecutionContext } from "../commands/types";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "./interaction-response";

export interface CommandContext {
  client: Client;
  interaction: CommandHandlerInteraction;
  user: User;
  guild: Guild | null;
  member: GuildMember | null;
  logger: ReturnType<typeof createLogger>;
  env: {
    get: (name: string) => string | undefined;
    getRequired: (name: string) => string;
  };
  redis?: CommandExecutionContext["redis"];
  postgresPool?: CommandExecutionContext["postgresPool"];
  serviceMode?: CommandExecutionContext["serviceMode"];
  legacyContext?: CommandExecutionContext;
  reply: (options: InteractionReplyOptions | MessagePayload) => Promise<void>;
  defer: (options?: InteractionDeferReplyOptions) => Promise<void>;
  safeReply: (options: InteractionReplyOptions | MessagePayload) => Promise<void>;
  getSubcommand: (options?: { required?: boolean }) => string | null;
  getSubcommandGroup: (options?: { required?: boolean }) => string | null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type CommandHandlerInteraction =
  | ChatInputCommandInteraction
  | AutocompleteInteraction;

function isChatInput(
  interaction: CommandHandlerInteraction
): interaction is ChatInputCommandInteraction {
  return interaction.isChatInputCommand();
}

function isAutocomplete(
  interaction: CommandHandlerInteraction
): interaction is AutocompleteInteraction {
  return interaction.isAutocomplete();
}

export function createContext({
  client,
  interaction,
  legacyContext,
  commandName
}: {
  client: Client;
  interaction: CommandHandlerInteraction;
  legacyContext?: CommandExecutionContext;
  commandName: string;
}): CommandContext {
  const logger = createLogger("discord");
  const user = interaction.user;
  const guild = interaction.guild ?? null;
  const member =
    interaction.member && "permissions" in interaction.member
      ? (interaction.member as GuildMember)
      : null;

  const reply = async (options: InteractionReplyOptions | MessagePayload) => {
    if (!isChatInput(interaction)) {
      return;
    }
    await safeRespond(interaction, options);
  };

  const defer = async (options?: InteractionDeferReplyOptions) => {
    if (!isChatInput(interaction)) {
      return;
    }
    await safeDefer(interaction, options);
  };

  const safeReply = async (options: InteractionReplyOptions | MessagePayload) => {
    if (!isChatInput(interaction)) {
      return;
    }
    await safeEditOrFollowUp(interaction, options);
  };

  const getSubcommand = (options?: { required?: boolean }) => {
    if (!isChatInput(interaction)) {
      return null;
    }
    return interaction.options.getSubcommand(options);
  };

  const getSubcommandGroup = (options?: { required?: boolean }) => {
    if (!isChatInput(interaction)) {
      return null;
    }
    return interaction.options.getSubcommandGroup(options);
  };

  return {
    client,
    interaction,
    user,
    guild,
    member,
    logger,
    env: {
      get: (name) => process.env[name],
      getRequired: getRequiredEnv
    },
    redis: legacyContext?.redis,
    postgresPool: legacyContext?.postgresPool ?? null,
    serviceMode: legacyContext?.serviceMode,
    legacyContext,
    reply,
    defer,
    safeReply,
    getSubcommand,
    getSubcommandGroup
  };
}
