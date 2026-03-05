import fs from "node:fs";
import path from "node:path";
import { lockDir } from "./paths.js";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 120_000; // Consider lock stale after 120s (tolerates clock skew)

/**
 * Acquire an exclusive lock using mkdir (atomic on all platforms).
 * Returns a release function.
 */
export function acquireLock(name: string): () => void {
  const lockBase = lockDir();
  fs.mkdirSync(lockBase, { recursive: true });
  const lockPath = path.join(lockBase, `${name}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockPath);
      // Lock acquired — write PID and timestamp for stale detection
      try {
        fs.writeFileSync(
          path.join(lockPath, "pid"),
          JSON.stringify({ pid: process.pid, ts: Date.now() }),
        );
      } catch {
        // Non-critical
      }
      return () => {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // Already released
        }
      };
    } catch {
      // Lock held by another process — check for staleness
      try {
        const pidFile = path.join(lockPath, "pid");
        const raw = fs.readFileSync(pidFile, "utf-8").trim();
        let pid: number;
        let ts: number;
        try {
          const info = JSON.parse(raw);
          pid = typeof info?.pid === "number" ? info.pid : NaN;
          ts = typeof info?.ts === "number" ? info.ts : 0;
        } catch {
          // Legacy format: plain PID string
          pid = parseInt(raw, 10);
          ts = 0;
        }

        let isStale = false;

        if (isNaN(pid)) {
          isStale = true;
        } else {
          // Check if holder process is dead
          try {
            process.kill(pid, 0);
            // Process exists — but PID may have been recycled.
            // Use timestamp to detect stale locks from recycled PIDs.
            if (ts > 0 && Date.now() - ts > LOCK_STALE_MS) {
              isStale = true;
            }
          } catch {
            // Process is dead — safe to remove
            isStale = true;
          }
        }

        if (isStale) {
          try {
            fs.rmSync(lockPath, { recursive: true, force: true });
          } catch { /* ignore */ }
          continue;
        }
      } catch {
        // Can't read lock info — wait and retry
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }

  throw new Error(
    `Failed to acquire lock "${name}" within ${LOCK_TIMEOUT_MS}ms`,
  );
}

/**
 * Execute a function while holding a lock.
 */
export function withLock<T>(name: string, fn: () => T): T {
  const release = acquireLock(name);
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * Non-busy sleep using Atomics.wait (blocks thread without CPU spin).
 */
function sleepSync(ms: number): void {
  const buf = new SharedArrayBuffer(4);
  const arr = new Int32Array(buf);
  Atomics.wait(arr, 0, 0, ms);
}
