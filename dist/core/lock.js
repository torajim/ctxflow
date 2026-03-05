import fs from "node:fs";
import path from "node:path";
import { lockDir } from "./paths.js";
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;
/**
 * Acquire an exclusive lock using mkdir (atomic on all platforms).
 * Returns a release function.
 */
export function acquireLock(name) {
    const lockBase = lockDir();
    fs.mkdirSync(lockBase, { recursive: true });
    const lockPath = path.join(lockBase, `${name}.lock`);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            fs.mkdirSync(lockPath);
            // Lock acquired — write PID for debugging stale locks
            try {
                fs.writeFileSync(path.join(lockPath, "pid"), String(process.pid));
            }
            catch {
                // Non-critical
            }
            return () => {
                try {
                    fs.rmSync(lockPath, { recursive: true, force: true });
                }
                catch {
                    // Already released
                }
            };
        }
        catch {
            // Lock held by another process — check for staleness
            try {
                const pidFile = path.join(lockPath, "pid");
                const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
                if (!isNaN(pid)) {
                    try {
                        process.kill(pid, 0);
                    }
                    catch {
                        // Process is dead — remove stale lock
                        fs.rmSync(lockPath, { recursive: true, force: true });
                        continue;
                    }
                }
            }
            catch {
                // Can't read lock info — wait and retry
            }
            sleepSync(LOCK_RETRY_MS);
        }
    }
    throw new Error(`Failed to acquire lock "${name}" within ${LOCK_TIMEOUT_MS}ms`);
}
/**
 * Execute a function while holding a lock.
 */
export function withLock(name, fn) {
    const release = acquireLock(name);
    try {
        return fn();
    }
    finally {
        release();
    }
}
function sleepSync(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // Busy wait — only used for short durations during lock contention
    }
}
//# sourceMappingURL=lock.js.map