import crypto from "crypto";
import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import { buildBaseEmbed } from "../embeds";
import { createLogger } from "@project/shared";
import type { CommandExecutionContext } from "../commands/types";
import type { Command } from "./Command";
import { createContext } from "./Context";
import { runMiddleware } from "./middleware";
import { getCommand } from "./registry";

const handlerLogger = createLogger("discord");
const logCommandEvents = process.env.LOG_COMMAND_EVENTS === "1";

function createErrorResponse(correlationId: string, version: string) {
  return buildBaseEmbed(
    { serviceName: "bot", version },
    {
      title: "Command Error",
      description: `Something went wrong. Reference: \`${correlationId}\`.`,
      variant: "error"
    }
  );
}

async function handleMiddlewareFailure(
  interaction: ChatInputCommandInteraction,
  message: string
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content: message, ephemeral: true });
    return;
  }
  await interaction.reply({ content: message, ephemeral: true });
}

async function executeCommand(
  command: Command,
  interaction: ChatInputCommandInteraction,
  legacyContext: CommandExecutionContext
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const context = createContext({
    client: legacyContext.client,
    interaction,
    legacyContext,
    commandName: command.name
  });

  if (logCommandEvents) {
    handlerLogger.info(
      `event=command_execute command=${command.name} user=${context.user.id} guild=${context.guild?.id ?? "dm"} interaction=${interaction.id}`
    );
  }

  const middlewareResult = runMiddleware(command, context);
  if (!middlewareResult.ok) {
    await handleMiddlewareFailure(interaction, middlewareResult.message ?? "Command blocked.");
    return;
  }

  try {
    await command.execute(context);
    if (logCommandEvents) {
      handlerLogger.info(
        `event=command_complete command=${command.name} user=${context.user.id} guild=${context.guild?.id ?? "dm"} interaction=${interaction.id}`
      );
    }
  } catch (error) {
    const stack = error instanceof Error ? error.stack ?? error.message : String(error);
    handlerLogger.error(
      `event=command_failed command=${command.name} user=${context.user.id} guild=${context.guild?.id ?? "dm"} interaction=${interaction.id} correlation=${correlationId}`
    );
    handlerLogger.error(`stack="${stack}"`);

    const version = legacyContext.getVersion();
    const embed = createErrorResponse(correlationId, version);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
      return;
    }
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function executeAutocomplete(
  command: Command,
  interaction: AutocompleteInteraction,
  legacyContext: CommandExecutionContext
): Promise<void> {
  if (!command.autocomplete) {
    return;
  }

  const correlationId = crypto.randomUUID();
  const context = createContext({
    client: legacyContext.client,
    interaction,
    legacyContext,
    commandName: command.name
  });

  try {
    const result = await command.autocomplete({ ...context, interaction });
    if (Array.isArray(result)) {
      await interaction.respond(result);
    }
  } catch (error) {
    const stack = error instanceof Error ? error.stack ?? error.message : String(error);
    handlerLogger.error(
      `event=autocomplete_failed command=${command.name} user=${context.user.id} guild=${context.guild?.id ?? "dm"} interaction=${interaction.id} correlation=${correlationId}`
    );
    handlerLogger.error(`stack="${stack}"`);
  }
}

export async function handleInteraction({
  interaction,
  legacyContext
}: {
  interaction: ChatInputCommandInteraction | AutocompleteInteraction;
  legacyContext: CommandExecutionContext;
}): Promise<void> {
  if (interaction.isAutocomplete()) {
    const command = getCommand(interaction.commandName);
    if (!command) {
      return;
    }
    await executeAutocomplete(command, interaction, legacyContext);
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = getCommand(interaction.commandName);
  if (!command) {
    return;
  }

  await executeCommand(command, interaction, legacyContext);
}
