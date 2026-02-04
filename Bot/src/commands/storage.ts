import { createLogger } from "@project/shared";
import type { Pool } from "pg";
import type { GuildSettings } from "./guild-settings";

export interface GuildConfig {
  guildId: string;
  prefix: string | null;
  logsChannelId: string | null;
  welcomeTemplate: string | null;
  goodbyeTemplate: string | null;
  autoroleId: string | null;
  modroleId: string | null;
  adminroleId: string | null;
  toggles: Record<string, boolean>;
  rulesText: string | null;
  settings: GuildSettings | null;
}

export interface ModlogEntry {
  id: number;
  guildId: string;
  action: string;
  target: string;
  reason: string;
  moderatorId: string;
  createdAt: Date;
}

export interface WarningEntry {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: Date;
}

export interface ReportEntry {
  id: number;
  guildId: string;
  reporterId: string;
  targetId: string;
  reason: string;
  createdAt: Date;
}

interface GuildConfigRow {
  guild_id: string;
  prefix: string | null;
  logs_channel_id: string | null;
  welcome_template: string | null;
  goodbye_template: string | null;
  autorole_id: string | null;
  modrole_id: string | null;
  adminrole_id: string | null;
  toggles: Record<string, boolean> | null;
  rules_text: string | null;
  settings: GuildSettings | null;
}

interface WarningRow {
  id: number;
  guild_id: string;
  user_id: string;
  moderator_id: string;
  reason: string;
  created_at: string;
}

interface ModlogRow {
  id: number;
  guild_id: string;
  action: string;
  target: string;
  reason: string;
  moderator_id: string;
  created_at: string;
}

interface ReportRow {
  id: number;
  guild_id: string;
  reporter_id: string;
  target_id: string;
  reason: string;
  created_at: string;
}

const logger = createLogger("discord");

const tableInit = new Map<string, Promise<void>>();

async function ensureTable(pool: Pool, name: string, createSql: string): Promise<void> {
  if (tableInit.has(name)) {
    await tableInit.get(name);
    return;
  }
  const promise = pool
    .query(createSql)
    .then(() => {
      logger.info(`event=db_table_ready table=${name}`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`event=db_table_failed table=${name} message="${message}"`);
      throw error;
    });
  tableInit.set(name, promise);
  await promise;
}

async function ensureGuildConfigTable(pool: Pool): Promise<void> {
  await ensureTable(
    pool,
    "guild_configs",
    `CREATE TABLE IF NOT EXISTS guild_configs (
      guild_id TEXT PRIMARY KEY,
      prefix TEXT,
      logs_channel_id TEXT,
      welcome_template TEXT,
      goodbye_template TEXT,
      autorole_id TEXT,
      modrole_id TEXT,
      adminrole_id TEXT,
      toggles JSONB DEFAULT '{}'::jsonb,
      rules_text TEXT,
      settings JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  await pool.query(
    "ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb"
  );
}

async function ensureWarningsTable(pool: Pool): Promise<void> {
  await ensureTable(
    pool,
    "warnings",
    `CREATE TABLE IF NOT EXISTS warnings (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

async function ensureModlogTable(pool: Pool): Promise<void> {
  await ensureTable(
    pool,
    "modlogs",
    `CREATE TABLE IF NOT EXISTS modlogs (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      reason TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

async function ensureReportsTable(pool: Pool): Promise<void> {
  await ensureTable(
    pool,
    "reports",
    `CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

export async function getGuildConfig(
  pool: Pool,
  guildId: string
): Promise<GuildConfig | null> {
  await ensureGuildConfigTable(pool);
  const result = await pool.query(
    "SELECT * FROM guild_configs WHERE guild_id = $1",
    [guildId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0] as GuildConfigRow;
  return {
    guildId: row.guild_id,
    prefix: row.prefix,
    logsChannelId: row.logs_channel_id,
    welcomeTemplate: row.welcome_template,
    goodbyeTemplate: row.goodbye_template,
    autoroleId: row.autorole_id,
    modroleId: row.modrole_id,
    adminroleId: row.adminrole_id,
    toggles: row.toggles ?? {},
    rulesText: row.rules_text,
    settings: row.settings ?? null
  };
}

async function upsertGuildConfig(
  pool: Pool,
  guildId: string,
  update: Partial<GuildConfig>
): Promise<void> {
  await ensureGuildConfigTable(pool);
  const fields: { column: string; value: unknown }[] = [];
  if (update.prefix !== undefined) {
    fields.push({ column: "prefix", value: update.prefix });
  }
  if (update.logsChannelId !== undefined) {
    fields.push({ column: "logs_channel_id", value: update.logsChannelId });
  }
  if (update.welcomeTemplate !== undefined) {
    fields.push({ column: "welcome_template", value: update.welcomeTemplate });
  }
  if (update.goodbyeTemplate !== undefined) {
    fields.push({ column: "goodbye_template", value: update.goodbyeTemplate });
  }
  if (update.autoroleId !== undefined) {
    fields.push({ column: "autorole_id", value: update.autoroleId });
  }
  if (update.modroleId !== undefined) {
    fields.push({ column: "modrole_id", value: update.modroleId });
  }
  if (update.adminroleId !== undefined) {
    fields.push({ column: "adminrole_id", value: update.adminroleId });
  }
  if (update.rulesText !== undefined) {
    fields.push({ column: "rules_text", value: update.rulesText });
  }
  if (update.settings !== undefined) {
    fields.push({ column: "settings", value: update.settings });
  }
  if (fields.length === 0) {
    return;
  }
  const columns = fields.map((field) => field.column);
  const values = fields.map((field) => field.value);
  const placeholders = values.map((_, index) => `$${index + 2}`);
  const updates = columns.map((column, index) => `${column} = $${index + 2}`);
  updates.push("updated_at = NOW()");
  await pool.query(
    `INSERT INTO guild_configs (guild_id, ${columns.join(", ")})
     VALUES ($1, ${placeholders.join(", ")})
     ON CONFLICT (guild_id) DO UPDATE SET ${updates.join(", ")}`,
    [guildId, ...values]
  );
}

export async function setGuildPrefix(pool: Pool, guildId: string, prefix: string): Promise<void> {
  await upsertGuildConfig(pool, guildId, { prefix });
}

export async function setGuildLogsChannel(
  pool: Pool,
  guildId: string,
  logsChannelId: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { logsChannelId });
}

export async function setGuildWelcomeTemplate(
  pool: Pool,
  guildId: string,
  template: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { welcomeTemplate: template });
}

export async function setGuildGoodbyeTemplate(
  pool: Pool,
  guildId: string,
  template: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { goodbyeTemplate: template });
}

export async function setGuildAutorole(
  pool: Pool,
  guildId: string,
  roleId: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { autoroleId: roleId });
}

export async function setGuildModrole(
  pool: Pool,
  guildId: string,
  roleId: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { modroleId: roleId });
}

export async function setGuildAdminrole(
  pool: Pool,
  guildId: string,
  roleId: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { adminroleId: roleId });
}

export async function setGuildRulesText(
  pool: Pool,
  guildId: string,
  rulesText: string | null
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { rulesText });
}

export async function setGuildSettings(
  pool: Pool,
  guildId: string,
  settings: GuildSettings
): Promise<void> {
  await upsertGuildConfig(pool, guildId, { settings });
}

export async function setGuildToggle(
  pool: Pool,
  guildId: string,
  name: string,
  enabled: boolean
): Promise<void> {
  await ensureGuildConfigTable(pool);
  const payload = JSON.stringify({ [name]: enabled });
  await pool.query(
    `INSERT INTO guild_configs (guild_id, toggles)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (guild_id) DO UPDATE
       SET toggles = COALESCE(guild_configs.toggles, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()`,
    [guildId, payload]
  );
}

export async function createWarning(
  pool: Pool,
  guildId: string,
  userId: string,
  moderatorId: string,
  reason: string
): Promise<void> {
  await ensureWarningsTable(pool);
  await pool.query(
    "INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES ($1, $2, $3, $4)",
    [guildId, userId, moderatorId, reason]
  );
}

export async function listWarnings(
  pool: Pool,
  guildId: string,
  userId: string
): Promise<WarningEntry[]> {
  await ensureWarningsTable(pool);
  const result = await pool.query(
    "SELECT * FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC",
    [guildId, userId]
  );
  return (result.rows as WarningRow[]).map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    moderatorId: row.moderator_id,
    reason: row.reason,
    createdAt: new Date(row.created_at)
  }));
}

export async function createModlog(
  pool: Pool,
  guildId: string,
  action: string,
  target: string,
  reason: string,
  moderatorId: string
): Promise<void> {
  await ensureModlogTable(pool);
  await pool.query(
    "INSERT INTO modlogs (guild_id, action, target, reason, moderator_id) VALUES ($1, $2, $3, $4, $5)",
    [guildId, action, target, reason, moderatorId]
  );
}

export async function listModlogs(
  pool: Pool,
  guildId: string,
  limit: number
): Promise<ModlogEntry[]> {
  await ensureModlogTable(pool);
  const result = await pool.query(
    "SELECT * FROM modlogs WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2",
    [guildId, limit]
  );
  return (result.rows as ModlogRow[]).map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    action: row.action,
    target: row.target,
    reason: row.reason,
    moderatorId: row.moderator_id,
    createdAt: new Date(row.created_at)
  }));
}

export async function createReport(
  pool: Pool,
  guildId: string,
  reporterId: string,
  targetId: string,
  reason: string
): Promise<void> {
  await ensureReportsTable(pool);
  await pool.query(
    "INSERT INTO reports (guild_id, reporter_id, target_id, reason) VALUES ($1, $2, $3, $4)",
    [guildId, reporterId, targetId, reason]
  );
}
