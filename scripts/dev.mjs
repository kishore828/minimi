#!/usr/bin/env node
/**
 * Cross-platform dev launcher.
 * Runs `next dev` and mirrors output to dev.log so logs are easy to inspect
 * on any platform (macOS / Linux / Windows) without relying on `tee`.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || '3000';
const LOG_FILE = fileURLToPath(new URL('../dev.log', import.meta.url));

// Rotate the previous log if it grows beyond ~5 MB.
try {
  if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 5 * 1024 * 1024) {
    try {
      unlinkSync(`${LOG_FILE}.1`);
    } catch {
      // Best effort only.
    }
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
  }
} catch {
  // Rotation is best-effort only.
}

const logStream = createWriteStream(LOG_FILE, { flags: 'a' });

const childEnv = { ...process.env };
delete childEnv.NODE_ENV;

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npx, ['next', 'dev', '-p', PORT], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: childEnv,
});

const tee = (chunk) => {
  const text = chunk.toString();
  try {
    process.stdout.write(text);
    logStream.write(text);
  } catch {
    // Never crash the server because of logging.
  }
};

child.stdout.on('data', tee);
child.stderr.on('data', tee);

child.on('exit', (code) => {
  logStream.end();
  process.exit(code ?? 0);
});

const shutdown = () => {
  child.kill('SIGTERM');
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
