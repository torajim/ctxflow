import fs from "node:fs";
import {
  getCurrentSessionId,
  getSession,
  listWorkers,
  listSessions,
  saveWorker,
  updateHeartbeat,
  removeSession,
} from "./core/task.js";
import { hasGitRemote, ensureCtxflowBranch, fullSync } from "./core/sync.js";
import { daemonPidFile, daemonLockFile } from "./core/paths.js";
import { logDebug } from "./core/log.js";
import { loadConfig } from "./core/config.js";

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let shutdownRequested = false;

function writePid(): void {
  fs.writeFileSync(daemonPidFile(), String(process.pid));
}

function removePidFile(): void {
  try {
    fs.unlinkSync(daemonPidFile());
  } catch {
    // Already removed
  }
}

function removeLockFile(): void {
  try {
    fs.unlinkSync(daemonLockFile());
  } catch {
    // Already removed
  }
}

/**
 * Acquire daemon lock using atomic file creation (O_EXCL).
 * Returns true if lock acquired, false if another daemon holds it.
 */
function acquireDaemonLock(): boolean {
  try {
    fs.writeFileSync(daemonLockFile(), String(process.pid), { flag: "wx" });
    return true;
  } catch {
    // Lock file exists — check if holder is alive
    try {
      const pid = parseInt(fs.readFileSync(daemonLockFile(), "utf-8").trim(), 10);
      if (!isNaN(pid) && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          return false; // Another daemon is alive
        } catch {
          // Holder is dead — remove stale lock and retry
          removeLockFile();
          try {
            fs.writeFileSync(daemonLockFile(), String(process.pid), { flag: "wx" });
            return true;
          } catch {
            return false;
          }
        }
      }
    } catch {
      // Can't read lock file — try to remove and retry once
      removeLockFile();
      try {
        fs.writeFileSync(daemonLockFile(), String(process.pid), { flag: "wx" });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function markInactiveWorkers(): void {
  const config = loadConfig();
  const workers = listWorkers();
  const now = Date.now();

  for (const worker of workers) {
    if (
      (worker.status === "working" || worker.status === "idle") &&
      now - new Date(worker.last_heartbeat).getTime() > config.inactiveThresholdMs
    ) {
      saveWorker({ ...worker, status: "disconnected" });
      logDebug(`marked ${worker.name} (${worker.session_id}) as disconnected (heartbeat timeout)`);
    }
  }
}

function cleanupOrphanedSessions(): void {
  const sessions = listSessions();
  const workers = listWorkers();
  const workerSessionIds = new Set(workers.map((w) => w.session_id));

  for (const session of sessions) {
    if (!workerSessionIds.has(session.session_id)) {
      logDebug(`cleaning up orphaned session: ${session.session_id}`);
      try {
        removeSession(session.session_id);
      } catch {
        // Best effort
      }
    }
  }
}

async function syncLoop(): Promise<void> {
  if (syncing || shutdownRequested) return;
  syncing = true;

  try {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      logDebug("no CTXFLOW_SESSION env var, skipping sync");
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      logDebug(`session ${sessionId} not found, skipping sync`);
      return;
    }

    updateHeartbeat(sessionId);

    if (!(await hasGitRemote())) return;

    await ensureCtxflowBranch();
    await fullSync(sessionId);
    markInactiveWorkers();
  } catch (err) {
    logDebug(`sync error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    syncing = false;
    scheduleNextSync();
  }
}

function scheduleNextSync(): void {
  if (shutdownRequested) return;
  const config = loadConfig();
  syncTimeout = setTimeout(() => {
    syncLoop();
  }, config.syncIntervalMs);
}

export function isDaemonRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(daemonPidFile(), "utf-8").trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopDaemon(): void {
  try {
    const pid = parseInt(fs.readFileSync(daemonPidFile(), "utf-8").trim(), 10);
    if (!isNaN(pid)) {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process may already be dead
  }
  removePidFile();
}

function gracefulShutdown(): void {
  shutdownRequested = true;
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
  removePidFile();
  removeLockFile();
  logDebug("Daemon stopped gracefully");
  process.exit(0);
}

export async function runDaemon(): Promise<void> {
  if (!acquireDaemonLock()) {
    logDebug("Another daemon holds the lock, exiting.");
    return;
  }

  if (isDaemonRunning()) {
    removeLockFile();
    logDebug("Daemon already running, exiting.");
    return;
  }

  writePid();

  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);

  const sessionId = getCurrentSessionId();
  logDebug(`Daemon started (pid ${process.pid}, session ${sessionId ?? "none"})`);

  // Run once immediately — scheduleNextSync is called in the finally block
  await syncLoop();
}
