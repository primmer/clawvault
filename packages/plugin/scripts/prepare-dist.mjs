import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

const sourceHandlerPath = path.join(repoRoot, 'hooks', 'clawvault', 'handler.js');
const sourcePluginConfigPath = path.join(repoRoot, 'hooks', 'clawvault', 'openclaw.plugin.json');

const distDir = path.join(packageRoot, 'dist');
const distHandlerPath = path.join(distDir, 'handler.js');
const distIndexPath = path.join(distDir, 'index.js');
const packagePluginConfigPath = path.join(packageRoot, 'openclaw.plugin.json');

if (!fs.existsSync(sourceHandlerPath)) {
  throw new Error(`Missing source handler: ${sourceHandlerPath}`);
}
if (!fs.existsSync(sourcePluginConfigPath)) {
  throw new Error(`Missing source plugin config: ${sourcePluginConfigPath}`);
}

fs.mkdirSync(distDir, { recursive: true });

fs.copyFileSync(sourceHandlerPath, distHandlerPath);
fs.writeFileSync(distIndexPath, "export { default as handler } from './handler.js';\n", 'utf-8');
fs.copyFileSync(sourcePluginConfigPath, packagePluginConfigPath);

console.log('Built plugin dist artifacts');
