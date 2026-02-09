import express from 'express';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVaultGraph } from './lib/vault-parser.js';

const DEFAULT_PORT = 3377;
const HOST = '0.0.0.0';

export async function startDashboard(options = {}) {
  const port = normalizePort(options.port ?? DEFAULT_PORT);
  const vaultPath = resolveVaultPath(options.vaultPath);
  await assertVaultPath(vaultPath);

  const app = express();
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(serverDir, '..');
  const publicDir = path.join(serverDir, 'public');
  const forceGraphDistDir = path.join(projectDir, 'node_modules', 'force-graph', 'dist');

  const graphCache = createGraphCache(vaultPath);

  app.get('/api/graph', async (req, res) => {
    try {
      const shouldRefresh = req.query.refresh === '1';
      const graph = await graphCache.get({ forceRefresh: shouldRefresh });
      res.json(graph);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to build graph',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      vaultPath
    });
  });

  app.use('/vendor', express.static(forceGraphDistDir));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  const server = await new Promise((resolve, reject) => {
    const runningServer = app
      .listen(port, HOST, () => resolve(runningServer))
      .on('error', reject);
  });

  logStartup({
    port,
    vaultPath
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

function createGraphCache(vaultPath) {
  const ttlMs = 2_000;
  let cache = null;
  let fetchedAt = 0;
  let inFlight = null;

  return {
    async get({ forceRefresh = false } = {}) {
      const ageMs = Date.now() - fetchedAt;
      if (!forceRefresh && cache && ageMs < ttlMs) {
        return cache;
      }

      if (inFlight) {
        return inFlight;
      }

      inFlight = buildVaultGraph(vaultPath)
        .then((graph) => {
          cache = graph;
          fetchedAt = Date.now();
          return graph;
        })
        .finally(() => {
          inFlight = null;
        });

      return inFlight;
    }
  };
}

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    vaultPath: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      options.port = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--vault' || arg === '-v') {
      options.vaultPath = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

function normalizePort(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function resolveVaultPath(input) {
  const candidate = input || process.env.CLAWVAULT_PATH || process.cwd();
  return path.resolve(candidate);
}

async function assertVaultPath(vaultPath) {
  let stat;
  try {
    stat = await fs.stat(vaultPath);
  } catch (error) {
    throw new Error(`Vault path not found: ${vaultPath}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`);
  }
}

function logStartup({ port, vaultPath }) {
  const interfaces = os.networkInterfaces();
  const networkUrls = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) {
        continue;
      }
      networkUrls.push(`http://${address.address}:${port}`);
    }
  }

  console.log('\nClawVault Dashboard');
  console.log(`Vault: ${vaultPath}`);
  console.log(`Local: http://localhost:${port}`);
  for (const url of networkUrls) {
    console.log(`Network: ${url}`);
  }
  console.log('\nPress Ctrl+C to stop.\n');
}

const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFile === executedFile) {
  startDashboard(parseArgs(process.argv.slice(2))).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
      console.error('Port already in use.');
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  });
}
