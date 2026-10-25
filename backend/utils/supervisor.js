/**
 * supervisor.js — parallelCrawler workers ka watchdog
 *
 * 5 workers spawn karta hai, har 60s alive check karta hai,
 * jo worker crash ho jaye usse turant restart kar deta hai.
 * Log: data/supervisor.log
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NUM_WORKERS = 5;
const WORKER_SCRIPT = path.join(__dirname, 'parallelCrawler.js');
const LOG_FILE = path.join(__dirname, '..', 'data', 'supervisor.log');

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
};

const children = new Map();

const spawnWorker = (id) => {
  if (children.has(id) && children.get(id).proc.exitCode === null) return;
  log(`spawning worker ${id}`);
  const proc = spawn('node', [WORKER_SCRIPT, String(id)], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    windowsHide: true,
  });
  children.set(id, { proc, restarts: (children.get(id)?.restarts || 0) + 1 });
  proc.on('exit', (code, signal) => {
    log(`worker ${id} EXITED (code=${code}, signal=${signal}), restarts=${children.get(id)?.restarts}`);
    children.delete(id);
  });
};

// pehle restart attempt hi zyada hota hai — bina check ke sab spawn
for (let i = 0; i < NUM_WORKERS; i++) spawnWorker(i);

// har 60s: dead workers ko wapas spawn karo
setInterval(() => {
  for (let i = 0; i < NUM_WORKERS; i++) {
    const c = children.get(i);
    if (!c || c.proc.exitCode !== null) spawnWorker(i);
  }
}, 60 * 1000);

log('supervisor running — 5 workers monitored');

process.on('SIGINT', () => {
  log('supervisor stopping');
  for (const { proc } of children.values()) proc.kill('SIGKILL');
  process.exit(0);
});