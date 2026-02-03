declare module "discord.js" {
  export enum GatewayIntentBits {
    Guilds = 1
  }

  export type PermissionResolvable = string;

  export interface ApplicationCommandOptionChoiceData {
    name: string;
    value: string | number;
  }

  export interface InteractionReplyOptions {
    content?: string;
    embeds?: unknown[];
    ephemeral?: boolean;
  }

  export type MessagePayload = InteractionReplyOptions | string;

  export interface InteractionDeferReplyOptions {
    ephemeral?: boolean;
  }

  export interface User {
    id: string;
  }

  export interface Guild {
    id: string;
  }

  export interface PermissionsBitField {
    has(permission: PermissionResolvable): boolean;
  }

  export interface GuildMember {
    id: string;
    permissions: PermissionsBitField;
  }

  export interface CommandInteractionOptionResolver {
    getSubcommand(options?: { required?: boolean }): string | null;
    getSubcommandGroup(options?: { required?: boolean }): string | null;
  }

  export interface Interaction {
    isChatInputCommand(): this is ChatInputCommandInteraction;
    isAutocomplete(): this is AutocompleteInteraction;
  }

  export interface ChatInputCommandInteraction extends Interaction {
    id: string;
    commandName: string;
    createdTimestamp: number;
    user: User;
    guild: Guild | null;
    member: GuildMember | null;
    options: CommandInteractionOptionResolver;
    replied: boolean;
    deferred: boolean;
    reply(message: string | InteractionReplyOptions): Promise<void>;
    followUp(message: string | InteractionReplyOptions): Promise<void>;
    deferReply(options?: InteractionDeferReplyOptions): Promise<void>;
  }

  export interface AutocompleteInteraction extends Interaction {
    id: string;
    commandName: string;
    user: User;
    guild: Guild | null;
    member: GuildMember | null;
    respond(choices: ApplicationCommandOptionChoiceData[]): Promise<void>;
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
    name: string;
    setName(name: string): this;
    setDescription(description: string): this;
    toJSON(): unknown;
  }
}
