import * as fs from 'fs';
import * as path from 'path';
import { buildEntityIndex } from '../lib/entity-index.js';
import { autoLink, dryRunLink } from '../lib/auto-linker.js';
import { getVaultPath } from '../lib/config.js';

interface LinkOptions {
  all?: boolean;
  dryRun?: boolean;
}

export async function linkCommand(file: string | undefined, options: LinkOptions): Promise<void> {
  const vaultPath = getVaultPath();
  const index = buildEntityIndex(vaultPath);
  
  if (options.all) {
    await linkAllFiles(vaultPath, index, options.dryRun);
    return;
  }
  
  if (!file) {
    console.error('Error: Specify a file or use --all');
    process.exit(1);
  }
  
  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  
  await linkFile(filePath, index, options.dryRun);
}

async function linkFile(filePath: string, index: ReturnType<typeof buildEntityIndex>, dryRun?: boolean): Promise<number> {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  if (dryRun) {
    const matches = dryRunLink(content, index);
    if (matches.length > 0) {
      console.log(`\n📄 ${filePath}`);
      for (const m of matches) {
        console.log(`  Line ${m.line}: "${m.alias}" → [[${m.path}]]`);
      }
    }
    return matches.length;
  }
  
  const linked = autoLink(content, index);
  
  if (linked !== content) {
    fs.writeFileSync(filePath, linked);
    const matches = dryRunLink(content, index);
    console.log(`✓ Linked ${matches.length} entities in ${path.basename(filePath)}`);
    return matches.length;
  }
  
  return 0;
}

async function linkAllFiles(vaultPath: string, index: ReturnType<typeof buildEntityIndex>, dryRun?: boolean): Promise<void> {
  const files: string[] = [];
  
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden folders and archive
        if (!entry.name.startsWith('.') && entry.name !== 'archive' && entry.name !== 'templates') {
          walk(fullPath);
        }
      } else if (entry.name.endsWith('.md')) {
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
  
  console.log(`\n${dryRun ? '(dry run) ' : ''}${totalLinks} links in ${filesModified} files`);
}
