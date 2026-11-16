/**
 * Starts a project-local PostgreSQL cluster in ./.pgdata on port 5433.
 * Uses PostgreSQL binaries already installed on this machine (PG_BIN, a
 * standard install location, or PATH). Skip this script if you already run
 * PostgreSQL elsewhere and have pointed DATABASE_URL at it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.pgdata');
const logFile = path.join(dataDir, 'server.log');
const connectionString = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/wanasanaa';
const url = new URL(connectionString);
const port = url.port || '5433';
const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'wanasanaa';
const user = decodeURIComponent(url.username || 'postgres');
const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;

function findBin(name) {
  if (process.env.PG_BIN) {
    const candidate = path.join(process.env.PG_BIN, process.platform === 'win32' ? `${name}.exe` : name);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(base)) {
      const versions = fs
        .readdirSync(base)
        .filter((entry) => fs.existsSync(path.join(base, entry, 'bin', `${name}.exe`)))
        .sort((a, b) => Number(b) - Number(a));
      if (versions.length) return path.join(base, versions[0], 'bin', `${name}.exe`);
    }
  }

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
  });
  if (which.status === 0) {
    const first = which.stdout.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  }
  return null;
}

const bin = {
  initdb: findBin('initdb'),
  pgIsReady: findBin('pg_isready'),
  psql: findBin('psql'),
  postgres: findBin('postgres'),
};

if (!bin.initdb || !bin.pgIsReady || !bin.postgres) {
  console.error('Could not find PostgreSQL binaries. Set PG_BIN to the PostgreSQL bin directory.');
  process.exit(1);
}

function isReady() {
  const result = spawnSync(bin.pgIsReady, ['-h', host, '-p', port, '-U', user, '-q'], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

async function waitForReady(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function createDatabaseIfMissing() {
  if (!bin.psql) return;
  const check = spawnSync(
    bin.psql,
    ['-h', host, '-p', port, '-U', user, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${database}'`],
    { encoding: 'utf8' },
  );
  if (check.status !== 0) {
    console.warn(`could not inspect databases: ${check.stderr?.trim()}`);
    return;
  }
  if (check.stdout.trim() !== '1') {
    const created = spawnSync(
      bin.psql,
      ['-h', host, '-p', port, '-U', user, '-d', 'postgres', '-c', `CREATE DATABASE "${database}"`],
      { encoding: 'utf8' },
    );
    if (created.status === 0) console.log(`created database ${database}`);
    else console.warn(`could not create database: ${created.stderr?.trim()}`);
  }
}

if (isReady()) {
  console.log(`PostgreSQL already accepting connections on ${host}:${port}`);
  createDatabaseIfMissing();
  process.exit(0);
}

if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
  console.log('initialising local PostgreSQL cluster in .pgdata');
  const init = spawnSync(
    bin.initdb,
    ['-D', dataDir, '-U', user, '-A', 'trust', '-E', 'UTF8', '--locale=C'],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (init.status !== 0) process.exit(init.status ?? 1);
}

const log = fs.openSync(logFile, 'a');
const server = spawn(
  bin.postgres,
  ['-D', dataDir, '-p', port, '-c', 'listen_addresses=' + host],
  { detached: true, stdio: ['ignore', log, log] },
);
server.unref();

if (!(await waitForReady())) {
  console.error(`PostgreSQL did not become ready. See ${logFile}`);
  process.exit(1);
}

createDatabaseIfMissing();
console.log(`PostgreSQL ready on ${host}:${port} (data: .pgdata, log: .pgdata/server.log)`);
