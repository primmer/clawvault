/**
 * Smoke test — verify SDK loads and search works against local vault.
 */
import { ClawVault } from './dist/index.js';

const vault = new ClawVault({ path: process.env.HOME + '/clawvault' });

console.log('=== Vault Status ===');
const status = vault.status();
console.log(JSON.stringify(status, null, 2));

console.log('\n=== BM25 Search: "Pedro preferences" ===');
const bm25 = vault.searchBM25('Pedro preferences', { limit: 3 });
console.log(`${bm25.length} results`);
bm25.forEach((r, i) => console.log(`  ${i + 1}. [${r.file}] score=${r.score.toFixed(2)} "${r.title}"`));

console.log('\n=== Hybrid Search: "Pedro preferences" ===');
const hybrid = vault.searchHybrid('Pedro preferences', { limit: 3 });
console.log(`${hybrid.length} results`);
hybrid.forEach((r, i) => console.log(`  ${i + 1}. [${r.file}] score=${r.score.toFixed(2)} "${r.title}"`));

console.log('\n✅ SDK smoke test passed');
