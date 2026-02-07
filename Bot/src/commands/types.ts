import type {
  ApplicationCommandOptionChoiceData,
  AutocompleteInteraction,
  Client,
  ChatInputCommandInteraction,
  SlashCommandBuilder
} from "discord.js";
import type { RedisClient } from "@project/shared";
import type { Pool } from "pg";

export interface CommandExecutionContext {
  client: Client;
  gitRepoPath: string;
  workerHealthUrl: string | null;
  statusCheckTimeoutMs: number;
  statusCheckRetries: number;
  redis: RedisClient;
  postgresPool: Pool | null;
  serviceMode: string;
  getVersion: () => string;
}

export interface CommandDefinition {
  data: SlashCommandBuilder;
  execute: (
    interaction: ChatInputCommandInteraction,
    context: CommandExecutionContext
  ) => Promise<void>;
  autocomplete?: (
    interaction: AutocompleteInteraction,
    context: CommandExecutionContext
  ) => Promise<ApplicationCommandOptionChoiceData[] | void>;
}
