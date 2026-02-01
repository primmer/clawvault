import {
  autoLink,
  dryRunLink
} from "../chunk-4XJDHIKE.js";
import {
  getVaultPath
} from "../chunk-4KDZZW4X.js";
import {
  buildEntityIndex
} from "../chunk-J7ZWCI2C.js";

// src/commands/link.ts
import * as fs from "fs";
import * as path from "path";
async function linkCommand(file, options) {
  const vaultPath = getVaultPath();
  const index = buildEntityIndex(vaultPath);
  if (options.all) {
    await linkAllFiles(vaultPath, index, options.dryRun);
    return;
  }
  if (!file) {
    console.error("Error: Specify a file or use --all");
    process.exit(1);
  }
  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  await linkFile(filePath, index, options.dryRun);
}
async function linkFile(filePath, index, dryRun) {
  const content = fs.readFileSync(filePath, "utf-8");
  if (dryRun) {
    const matches = dryRunLink(content, index);
    if (matches.length > 0) {
      console.log(`
\u{1F4C4} ${filePath}`);
      for (const m of matches) {
        console.log(`  Line ${m.line}: "${m.alias}" \u2192 [[${m.path}]]`);
      }
    }
    return matches.length;
  }
  const linked = autoLink(content, index);
  if (linked !== content) {
    fs.writeFileSync(filePath, linked);
    const matches = dryRunLink(content, index);
    console.log(`\u2713 Linked ${matches.length} entities in ${path.basename(filePath)}`);
    return matches.length;
  }
  return 0;
}
async function linkAllFiles(vaultPath, index, dryRun) {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "archive" && entry.name !== "templates") {
          walk(fullPath);
        }
      } else if (entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }
  walk(vaultPath);
  let totalLinks = 0;
  let filesModified = 0;
  for (const file of files) {
    const links = await linkFile(file, index, dryRun);
    if (links > 0) {
      totalLinks += links;
      filesModified++;
    }
  }
  console.log(`
${dryRun ? "(dry run) " : ""}${totalLinks} links in ${filesModified} files`);
}
export {
  linkCommand
};
