import type {
  ChatInputCommandInteraction,
  InteractionDeferReplyOptions,
  InteractionReplyOptions,
  MessagePayload
} from "discord.js";
import { createLogger } from "@project/shared";
import { getErrorInfo } from "../discord-error-utils";

type ResponsePayload = InteractionReplyOptions | MessagePayload;
type InteractionReplyOptionsWithFlags = InteractionReplyOptions & {
  flags?: number | number[];
};
type InteractionDeferReplyOptionsWithFlags = InteractionDeferReplyOptions & {
  flags?: number | number[];
};

export type SafeResponseContext = {
  correlationId?: string;
  logger?: ReturnType<typeof createLogger>;
};

const EPHEMERAL_FLAG = 1 << 6;

function resolveFlags(
  existing: InteractionReplyOptionsWithFlags["flags"] | undefined,
  ephemeral: boolean
): InteractionReplyOptionsWithFlags["flags"] | undefined {
  if (!ephemeral) {
    return existing;
  }
  if (Array.isArray(existing)) {
    return Array.from(new Set([...existing, EPHEMERAL_FLAG]));
  }
  if (typeof existing === "number") {
    return existing | EPHEMERAL_FLAG;
  }
  if (existing) {
    return existing;
  }
  return EPHEMERAL_FLAG;
}

function normalizeReplyPayload(
  payload: ResponsePayload,
  ephemeralOverride?: boolean
): ResponsePayload {
  if (typeof payload !== "object" || payload === null) {
    return payload;
  }
  const record = payload as InteractionReplyOptionsWithFlags & { ephemeral?: boolean };
  const ephemeral =
    typeof ephemeralOverride === "boolean" ? ephemeralOverride : record.ephemeral;
  if (typeof ephemeral !== "boolean") {
    return payload;
  }
  const normalized: InteractionReplyOptionsWithFlags = { ...record };
  delete (normalized as { ephemeral?: boolean }).ephemeral;
  normalized.flags = resolveFlags(normalized.flags, ephemeral);
  return normalized;
}

function normalizeDeferOptions(
  options?: (InteractionDeferReplyOptionsWithFlags & { ephemeral?: boolean }) | null,
  ephemeralOverride?: boolean
): InteractionDeferReplyOptions | undefined {
  if (!options && typeof ephemeralOverride !== "boolean") {
    return options ?? undefined;
  }
  const record = (options ?? {}) as InteractionDeferReplyOptionsWithFlags & {
    ephemeral?: boolean;
  };
  const ephemeral =
    typeof ephemeralOverride === "boolean" ? ephemeralOverride : record.ephemeral;
  if (typeof ephemeral !== "boolean") {
    return record;
  }
  const normalized: InteractionDeferReplyOptionsWithFlags = { ...record };
  delete (normalized as { ephemeral?: boolean }).ephemeral;
  normalized.flags = resolveFlags(normalized.flags, ephemeral);
  return normalized;
}

function getLogger(context?: SafeResponseContext): ReturnType<typeof createLogger> {
  return context?.logger ?? createLogger("discord");
}

function shouldSwallowUnknownInteraction(error: unknown): boolean {
  const { code } = getErrorInfo(error);
  if (typeof code === "number") {
    return code === 10062;
  }
  if (typeof code === "string") {
    return Number(code) === 10062;
  }
  return false;
}

function logInteractionError(
  interaction: ChatInputCommandInteraction,
  action: string,
  error: unknown,
  context?: SafeResponseContext
): boolean {
  const logger = getLogger(context);
  if (shouldSwallowUnknownInteraction(error)) {
    logger.warn(
      `event=interaction_expired action=${action} interaction=${interaction.id} correlation=${context?.correlationId ?? "n/a"}`
    );
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.warn(
    `event=interaction_response_failed action=${action} interaction=${interaction.id} correlation=${context?.correlationId ?? "n/a"} message="${message}"`
  );
  return false;
}

export async function safeDefer(
  interaction: ChatInputCommandInteraction,
  options?: InteractionDeferReplyOptions & { ephemeral?: boolean },
  context?: SafeResponseContext
): Promise<boolean> {
  if (interaction.deferred || interaction.replied) {
    return true;
  }
  try {
    const normalized = normalizeDeferOptions(options);
    await interaction.deferReply(normalized);
    return true;
  } catch (error) {
    logInteractionError(interaction, "defer", error, context);
    return false;
  }
}

export async function safeRespond(
  interaction: ChatInputCommandInteraction,
  payload: ResponsePayload,
  context?: SafeResponseContext
): Promise<boolean> {
  const normalized = normalizeReplyPayload(payload);
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply(normalized);
      return true;
    }
    if (interaction.deferred) {
      await interaction.editReply(normalized);
      return true;
    }
    await interaction.followUp(normalized);
    return true;
  } catch (error) {
    logInteractionError(interaction, "respond", error, context);
    return false;
  }
}

export async function safeEditOrFollowUp(
  interaction: ChatInputCommandInteraction,
  payload: ResponsePayload,
  context?: SafeResponseContext
): Promise<boolean> {
  const normalized = normalizeReplyPayload(payload);
  try {
    if (interaction.deferred) {
      await interaction.editReply(normalized);
      return true;
    }
    if (interaction.replied) {
      await interaction.followUp(normalized);
      return true;
    }
    await interaction.reply(normalized);
    return true;
  } catch (error) {
    logInteractionError(interaction, "edit_or_followup", error, context);
    return false;
  }
}

export function shouldDeferByDeadline(
  interaction: ChatInputCommandInteraction,
  deadlineMs = 2500
): boolean {
  return (
    !interaction.deferred &&
    !interaction.replied &&
    Date.now() - interaction.createdTimestamp > deadlineMs
  );
}
