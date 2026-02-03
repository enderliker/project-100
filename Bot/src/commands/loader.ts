import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { createLogger } from "@project/shared";

const logger = createLogger("discord");

interface LoadResult {
  commands: CommandDefinition[];
}

function isCommandDefinition(value: unknown): value is CommandDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.execute === "function" &&
    record.data instanceof SlashCommandBuilder
  );
}

export async function discoverCommands(commandsDir: string): Promise<LoadResult> {
  if (!fs.existsSync(commandsDir)) {
    throw new Error(`command directory missing: ${commandsDir}`);
  }

  const entries = fs
    .readdirSync(commandsDir)
    .filter((entry) => entry.endsWith(".js") && !entry.startsWith("index."));

  const commands: CommandDefinition[] = [];
  const names = new Set<string>();

  for (const entry of entries) {
    const fullPath = path.join(commandsDir, entry);
    const moduleUrl = pathToFileURL(fullPath).toString();
    // eslint-disable-next-line no-await-in-loop
    const module = (await import(moduleUrl)) as { command?: unknown };
    if (!module.command || !isCommandDefinition(module.command)) {
      throw new Error(`invalid command module: ${entry}`);
    }
    const commandJson = module.command.data.toJSON() as { name?: string };
    const commandName = commandJson.name;
    if (!commandName) {
      throw new Error(`command missing name: ${entry}`);
    }
    if (names.has(commandName)) {
      throw new Error(`duplicate command name detected: ${commandName}`);
    }
    names.add(commandName);
    commands.push(module.command);
  }

  return { commands };
}

export interface ReloadedCommands {
  commands: CommandDefinition[];
  registeredCount: number;
}

export async function reloadCommands(options: {
  commandsDir: string;
  discordToken: string;
  discordAppId: string;
}): Promise<ReloadedCommands> {
  logger.info("event=commands_reload_start");
  const { commands } = await discoverCommands(options.commandsDir);
  logger.info(`event=commands_discovered count=${commands.length}`);

  const rest = new REST({ version: "10" }).setToken(options.discordToken);
  const payload = commands.map((command) => command.data.toJSON());
  const result = (await rest.put(Routes.applicationCommands(options.discordAppId), {
    body: payload
  })) as unknown[];

  logger.info(`event=commands_registered count=${result.length}`);
  logger.info("event=commands_reload_complete");
  return { commands, registeredCount: result.length };
}
