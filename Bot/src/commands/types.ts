import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export interface CommandContext {
  redisConnected: () => Promise<boolean>;
  postgresConnected: () => Promise<boolean | null>;
  serviceMode: string;
  gitRepoPath: string;
  version: string;
  workerHealthUrl: string;
  worker2HealthUrl: string;
  statusCheckTimeoutMs: number;
  statusCheckRetries: number;
  wsLatencyMs: () => number;
  uptimeSeconds: () => number;
}

export interface CommandDefinition {
  data: SlashCommandBuilder;
  execute: (
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ) => Promise<void>;
}
