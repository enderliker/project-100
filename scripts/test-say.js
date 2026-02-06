#!/usr/bin/env node
const assert = require("assert");
const path = require("path");

async function run() {
  const sayModulePath = path.join(
    __dirname,
    "..",
    "Bot",
    "dist",
    "commands",
    "say.js"
  );
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const sayModule = require(sayModulePath);

  const { validateSayMessage, buildSayPayload } = sayModule;
  assert.strictEqual(typeof validateSayMessage, "function");
  assert.strictEqual(typeof buildSayPayload, "function");

  const emptyCheck = validateSayMessage("   ");
  assert.strictEqual(emptyCheck.ok, false);

  const okCheck = validateSayMessage(" hello ");
  assert.strictEqual(okCheck.ok, true);
  assert.strictEqual(okCheck.message, "hello");

  const tooLong = validateSayMessage("a".repeat(2001));
  assert.strictEqual(tooLong.ok, false);

  const payload = buildSayPayload("hello");
  assert.ok(payload.allowedMentions);
  assert.ok(Array.isArray(payload.allowedMentions.parse));
  assert.strictEqual(payload.allowedMentions.parse.length, 0);

  const permissionsModulePath = path.join(
    __dirname,
    "..",
    "Bot",
    "dist",
    "command-handler",
    "command-permissions.js"
  );
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { canUseCommand } = require(permissionsModulePath);

  const result = await canUseCommand(
    { name: "say" },
    {
      guild: { id: "guild", roles: { cache: new Map() } },
      member: {
        permissions: { has: () => false },
        roles: { cache: new Map() }
      },
      user: { id: "user" },
      postgresPool: null
    }
  );
  assert.strictEqual(result.ok, false);

  console.log("test-say: ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
