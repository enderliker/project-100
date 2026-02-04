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
    username: string;
    tag?: string;
    bot?: boolean;
    createdAt?: Date;
    displayAvatarURL(options?: { size?: number; extension?: string }): string;
    bannerURL(options?: { size?: number; extension?: string }): string | null;
  }

  export interface Guild {
    id: string;
    name: string;
    ownerId?: string;
    memberCount?: number;
    createdAt?: Date;
    premiumTier?: number;
    premiumSubscriptionCount?: number;
    iconURL(options?: { size?: number; extension?: string }): string | null;
    bannerURL(options?: { size?: number; extension?: string }): string | null;
    members: GuildMemberManager;
    bans: GuildBanManager;
    channels: GuildChannelManager;
    roles: RoleManager;
  }

  export interface PermissionsBitField {
    has(permission: PermissionResolvable): boolean;
  }

  export interface GuildMember {
    id: string;
    permissions: PermissionsBitField;
    user: User;
    joinedAt?: Date;
    roles: GuildMemberRoleManager;
    kick(reason?: string): Promise<void>;
    timeout(duration: number | null, reason?: string): Promise<void>;
    setNickname(nickname: string | null, reason?: string): Promise<void>;
  }

  export interface Role {
    id: string;
    name: string;
  }

  export interface RoleManager {
    everyone: Role;
    cache: Map<string, Role>;
  }

  export interface GuildMemberRoleManager {
    cache: Map<string, Role>;
  }

  export interface GuildMemberManager {
    fetch(id: string): Promise<GuildMember>;
    ban(
      user: string | User,
      options?: { reason?: string; deleteMessageSeconds?: number }
    ): Promise<void>;
  }

  export interface GuildBanManager {
    remove(user: string | User, reason?: string): Promise<void>;
  }

  export interface Channel {
    id: string;
    isTextBased(): this is TextBasedChannel;
  }

  export interface TextBasedChannel extends Channel {
    send(options: InteractionReplyOptions | MessagePayload): Promise<void>;
  }

  export interface GuildChannelManager {
    fetch(id: string): Promise<Channel | null>;
  }

  export interface Message {
    id: string;
    author: User;
    content: string;
    createdTimestamp: number;
  }

  export interface MessageManager {
    fetch(options: { limit: number }): Promise<Map<string, Message>>;
  }

  export interface TextChannel extends TextBasedChannel {
    messages: MessageManager;
    bulkDelete(amount: number | Message[], filterOld?: boolean): Promise<number>;
    setRateLimitPerUser(seconds: number, reason?: string): Promise<void>;
    permissionOverwrites: PermissionOverwriteManager;
  }

  export interface PermissionOverwriteManager {
    edit(
      role: Role,
      options: { SendMessages?: boolean },
      reason?: string
    ): Promise<void>;
  }

  export interface CommandInteractionOptionResolver {
    getSubcommand(options?: { required?: boolean }): string | null;
    getSubcommandGroup(options?: { required?: boolean }): string | null;
    getUser(name: string, required?: boolean): User | null;
    getMember(name: string, required?: boolean): GuildMember | null;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
    getNumber(name: string, required?: boolean): number | null;
    getBoolean(name: string, required?: boolean): boolean | null;
    getChannel(name: string, required?: boolean): Channel | null;
    getRole(name: string, required?: boolean): Role | null;
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
    channel: Channel | null;
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
    constructor(options: ClientOptions);
    channels: ChannelManager;
    users: UserManager;
    once(event: string, listener: (...args: any[]) => void): void;
    on(event: string, listener: (...args: any[]) => void): void;
    login(token: string): Promise<void>;
    destroy(): void;
  }

  export interface ChannelManager {
    fetch(id: string): Promise<Channel | null>;
  }

  export interface UserManager {
    fetch(id: string): Promise<User>;
  }

  export interface ClientOptions {
    intents: GatewayIntentBits[];
    makeCache?: unknown;
    sweepers?: unknown;
  }

  export class REST {
    constructor(options: { version: string });
    setToken(token: string): this;
    put(route: string, options: { body: unknown }): Promise<unknown>;
  }

  export class Options {
    static cacheWithLimits(limits: Record<string, number>): unknown;
  }

  export const Routes: {
    applicationCommands(applicationId: string): string;
  };

  export class SlashCommandBuilder {
    name: string;
    setName(name: string): this;
    setDescription(description: string): this;
    setDefaultMemberPermissions(permissions: PermissionResolvable | null): this;
    setDMPermission(enabled: boolean): this;
    addUserOption(
      callback: (option: SlashCommandUserOption) => SlashCommandUserOption
    ): this;
    addStringOption(
      callback: (option: SlashCommandStringOption) => SlashCommandStringOption
    ): this;
    addIntegerOption(
      callback: (option: SlashCommandIntegerOption) => SlashCommandIntegerOption
    ): this;
    addNumberOption(
      callback: (option: SlashCommandNumberOption) => SlashCommandNumberOption
    ): this;
    addBooleanOption(
      callback: (option: SlashCommandBooleanOption) => SlashCommandBooleanOption
    ): this;
    addChannelOption(
      callback: (option: SlashCommandChannelOption) => SlashCommandChannelOption
    ): this;
    addRoleOption(
      callback: (option: SlashCommandRoleOption) => SlashCommandRoleOption
    ): this;
    toJSON(): unknown;
  }

  export interface BaseSlashCommandOption {
    setName(name: string): this;
    setDescription(description: string): this;
    setRequired(required: boolean): this;
    addChoices(...choices: ApplicationCommandOptionChoiceData[]): this;
  }

  export interface SlashCommandUserOption extends BaseSlashCommandOption {}
  export interface SlashCommandStringOption extends BaseSlashCommandOption {
    setMinLength(length: number): this;
    setMaxLength(length: number): this;
  }
  export interface SlashCommandIntegerOption extends BaseSlashCommandOption {
    setMinValue(value: number): this;
    setMaxValue(value: number): this;
  }
  export interface SlashCommandNumberOption extends BaseSlashCommandOption {
    setMinValue(value: number): this;
    setMaxValue(value: number): this;
  }
  export interface SlashCommandBooleanOption extends BaseSlashCommandOption {}
  export interface SlashCommandChannelOption extends BaseSlashCommandOption {}
  export interface SlashCommandRoleOption extends BaseSlashCommandOption {}
}
