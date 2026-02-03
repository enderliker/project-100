declare module "discord.js" {
  export enum GatewayIntentBits {
    Guilds = 1
  }

  export interface Interaction {
    isChatInputCommand(): this is ChatInputCommandInteraction;
  }

  export interface ChatInputCommandInteraction extends Interaction {
    commandName: string;
    createdTimestamp: number;
    deferred?: boolean;
    replied?: boolean;
    reply(message: string | InteractionReplyOptions): Promise<void>;
    followUp(message: string | InteractionReplyOptions): Promise<void>;
  }

  export interface InteractionReplyOptions {
    embeds?: unknown[];
    ephemeral?: boolean;
  }

  export class Client {
    ws: { ping: number };
    constructor(options: { intents: GatewayIntentBits[] });
    once(event: string, listener: (...args: any[]) => void): void;
    on(event: string, listener: (...args: any[]) => void): void;
    login(token: string): Promise<void>;
    destroy(): void;
  }

  export class REST {
    constructor(options: { version: string });
    setToken(token: string): this;
    put(route: string, options: { body: unknown }): Promise<unknown>;
  }

  export const Routes: {
    applicationCommands(applicationId: string): string;
  };

  export class SlashCommandBuilder {
    setName(name: string): this;
    setDescription(description: string): this;
    toJSON(): unknown;
  }
}
