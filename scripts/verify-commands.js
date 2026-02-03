#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.cwd();
const commandsSrcDir = path.join(ROOT_DIR, "Bot", "src", "commands");
const commandsDistDir = path.join(ROOT_DIR, "Bot", "dist", "commands");

const listCommandSources = () => {
  if (!fs.existsSync(commandsSrcDir)) {
    return [];
  }
  return fs
    .readdirSync(commandsSrcDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => entry.name);
};

const expectedOutputs = listCommandSources().map((file) =>
  file.replace(/\.ts$/, ".js"),
);

const missing = expectedOutputs.filter(
  (file) => !fs.existsSync(path.join(commandsDistDir, file)),
);

if (missing.length > 0) {
  console.error("[verify:commands] Missing compiled command outputs:");
  for (const file of missing) {
    console.error(`- ${path.join("Bot", "dist", "commands", file)}`);
  }
  process.exit(1);
}

console.log(
  `[verify:commands] OK (${expectedOutputs.length} command outputs present)`,
);
