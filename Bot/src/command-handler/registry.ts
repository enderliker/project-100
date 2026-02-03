import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { REST } from "discord.js";
import { Routes } from "discord.js";
import type { CommandDefinition } from "../commands/types";
import { createLogger } from "@project/shared";
import type { Command } from "./Command";

const registryLogger = createLogger("discord");
const commandRegistry = new Map<string, Command>();

export function registerCommand(command: Command): void {
  if (commandRegistry.has(command.name)) {
    throw new Error(`Duplicate command registration: ${command.name}`);
  }
  commandRegistry.set(command.name, command);
}

export function clearCommands(): void {
  commandRegistry.clear();
}

export function getCommand(name: string): Command | undefined {
  return commandRegistry.get(name);
}

export function getCommands(): Command[] {
  return Array.from(commandRegistry.values());
}

export function assertCommandSanity(): void {
  const names = new Set<string>();
  for (const command of commandRegistry.values()) {
    if (names.has(command.name)) {
      throw new Error(`Duplicate command detected in registry: ${command.name}`);
    }
    names.add(command.name);
  }
  registryLogger.info(`event=command_registry_ready count=${commandRegistry.size}`);
}

function isCommandDefinition(value: unknown): value is CommandDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { data?: unknown; execute?: unknown };
  if (typeof record.execute !== "function") {
    return false;
  }
  if (typeof record.data !== "object" || record.data === null) {
    return false;
  }
  const dataRecord = record.data as { toJSON?: unknown; name?: unknown };
  if (typeof dataRecord.toJSON !== "function") {
    return false;
  }
  if (typeof dataRecord.name !== "string" || dataRecord.name.length === 0) {
    return false;
  }
  return true;
}

export async function loadCommandDefinitions(
  commandsDir: string
): Promise<Map<string, CommandDefinition>> {
  if (!fs.existsSync(commandsDir)) {
    throw new Error(`Commands directory not found: ${commandsDir}`);
  }

  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();

  const definitions = new Map<string, CommandDefinition>();
  for (const file of files) {
    const modulePath = path.join(commandsDir, file);
    const moduleUrl = pathToFileURL(modulePath).toString();
    const loaded = await import(moduleUrl);
    const candidate = (loaded as { command?: unknown; default?: unknown }).command ??
      (loaded as { command?: unknown; default?: unknown }).default;

    if (!isCommandDefinition(candidate)) {
      throw new Error(`Invalid command module: ${file}`);
    }

    const name = candidate.data.name;
    if (definitions.has(name)) {
      throw new Error(`Duplicate command definition detected: ${name}`);
    }
    definitions.set(name, candidate);
  }

  return definitions;
}

export function registerCommandDefinitions(
  definitions: Map<string, CommandDefinition>
): void {
  clearCommands();
  for (const command of definitions.values()) {
    registerCommand({
      name: command.data.name,
      data: command.data,
      execute: async (context) => {
        if (!context.legacyContext) {
          throw new Error("Legacy command context unavailable");
        }
        if (!context.interaction.isChatInputCommand()) {
          return;
        }
        await command.execute(context.interaction, context.legacyContext);
      }
    });
  }
  assertCommandSanity();
}

export async function reloadDiscordCommands({
  commandsDir,
  rest,
  discordAppId
}: {
  commandsDir: string;
  rest: REST;
  discordAppId: string;
}): Promise<Map<string, CommandDefinition>> {
  registryLogger.info(`event=command_reload_start directory="${commandsDir}"`);
  const definitions = await loadCommandDefinitions(commandsDir);
  registryLogger.info(`event=command_discovered count=${definitions.size}`);

  const payload = Array.from(definitions.values()).map((command) => command.data.toJSON());
  await rest.put(Routes.applicationCommands(discordAppId), { body: payload });

  registryLogger.info(`event=command_registered count=${payload.length}`);
  registryLogger.info("event=command_reload_complete");
  return definitions;
}
