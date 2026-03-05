import fs from "node:fs";
import { getCurrentSessionId, getSession, listWorkers, listSessions, saveWorker, updateHeartbeat, removeSession, } from "./core/task.js";
import { hasGitRemote, ensureCtxflowBranch, fullSync } from "./core/sync.js";
import { daemonPidFile, daemonLockFile } from "./core/paths.js";
import { logDebug } from "./core/log.js";
import { loadConfig } from "./core/config.js";
let syncTimeout = null;
let syncing = false;
let shutdownRequested = false;
let releaseDaemonLock = null;
function writePid() {
    fs.writeFileSync(daemonPidFile(), String(process.pid));
}
function removePidFile() {
    try {
        // Only remove if we own the PID file
        const content = fs.readFileSync(daemonPidFile(), "utf-8").trim();
        if (parseInt(content, 10) === process.pid) {
            fs.unlinkSync(daemonPidFile());
        }
    }
    catch {
        // Already removed or unreadable
    }
}
/**
 * Acquire daemon lock using mkdir (atomic, same mechanism as lock.ts).
 * Returns a release function on success, null if another daemon holds it.
 */
function acquireDaemonLock() {
    const lockPath = daemonLockFile();
    try {
        fs.mkdirSync(lockPath);
    }
    catch {
        // Lock exists — check if holder is alive
        try {
            const infoPath = `${lockPath}/pid`;
            const raw = fs.readFileSync(infoPath, "utf-8").trim();
            let pid;
            try {
                const info = JSON.parse(raw);
                pid = typeof info?.pid === "number" ? info.pid : NaN;
            }
            catch {
                pid = parseInt(raw, 10);
            }
            if (!isNaN(pid) && pid !== process.pid) {
                try {
                    process.kill(pid, 0);
                    return null; // Another daemon is alive
                }
                catch {
                    // Holder is dead — reclaim
                }
            }
            // Remove stale lock and retry once
            fs.rmSync(lockPath, { recursive: true, force: true });
            try {
                fs.mkdirSync(lockPath);
            }
            catch {
                return null; // Lost race to another process
            }
        }
        catch {
            return null; // Can't read lock info
        }
    }
    // Write PID+timestamp into lock dir for staleness detection
    try {
        fs.writeFileSync(`${lockPath}/pid`, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    }
    catch { /* non-critical */ }
    return () => {
        try {
            fs.rmSync(lockPath, { recursive: true, force: true });
        }
        catch { /* already released */ }
    };
}
function markInactiveWorkers() {
    const config = loadConfig();
    const workers = listWorkers();
    const now = Date.now();
    for (const worker of workers) {
        if ((worker.status === "working" || worker.status === "idle") &&
            now - new Date(worker.last_heartbeat).getTime() > config.inactiveThresholdMs) {
            saveWorker({ ...worker, status: "disconnected" });
            logDebug(`marked ${worker.name} (${worker.session_id}) as disconnected (heartbeat timeout)`);
        }
    }
}
function cleanupOrphanedSessions() {
    const sessions = listSessions();
    const workers = listWorkers();
    const workerSessionIds = new Set(workers.map((w) => w.session_id));
    for (const session of sessions) {
        if (!workerSessionIds.has(session.session_id)) {
            logDebug(`cleaning up orphaned session: ${session.session_id}`);
            try {
                removeSession(session.session_id);
            }
            catch {
                // Best effort
            }
        }
    }
}
async function syncLoop() {
    if (syncing || shutdownRequested)
        return;
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
        // Stop daemon if our session was removed externally
        const activeSessions = listSessions();
        if (activeSessions.length === 0) {
            logDebug("No active sessions remaining, daemon shutting down");
            gracefulShutdown();
            return;
        }
        if (!(await hasGitRemote()))
            return;
        await ensureCtxflowBranch();
        await fullSync(sessionId);
        markInactiveWorkers();
        cleanupOrphanedSessions();
    }
    catch (err) {
        logDebug(`sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        syncing = false;
        scheduleNextSync();
    }
}
function scheduleNextSync() {
    if (shutdownRequested)
        return;
    try {
        const config = loadConfig();
        syncTimeout = setTimeout(() => {
            syncLoop();
        }, config.syncIntervalMs);
    }
    catch (err) {
        logDebug(`scheduleNextSync error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export function isDaemonRunning() {
    try {
        const pid = parseInt(fs.readFileSync(daemonPidFile(), "utf-8").trim(), 10);
        if (isNaN(pid))
            return false;
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export function stopDaemon() {
    try {
        const pid = parseInt(fs.readFileSync(daemonPidFile(), "utf-8").trim(), 10);
        if (!isNaN(pid)) {
            process.kill(pid, "SIGTERM");
        }
    }
    catch {
        // Process may already be dead
    }
    // Force remove PID file (stopDaemon is an explicit user action)
    try {
        fs.unlinkSync(daemonPidFile());
    }
    catch { /* ignore */ }
}
function gracefulShutdown() {
    if (shutdownRequested)
        return; // Prevent re-entry
    shutdownRequested = true;
    if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
    }
    // Wait for in-flight sync to finish (max 10s)
    const deadline = Date.now() + 10_000;
    const waitForSync = () => {
        if (!syncing || Date.now() > deadline) {
            removePidFile();
            if (releaseDaemonLock) {
                releaseDaemonLock();
                releaseDaemonLock = null;
            }
            logDebug("Daemon stopped gracefully");
            process.exit(0);
        }
        setTimeout(waitForSync, 100);
    };
    waitForSync();
}
export async function runDaemon() {
    const release = acquireDaemonLock();
    if (!release) {
        logDebug("Another daemon holds the lock, exiting.");
        return;
    }
    releaseDaemonLock = release;
    try {
        writePid();
        process.on("SIGTERM", gracefulShutdown);
        process.on("SIGINT", gracefulShutdown);
        const sessionId = getCurrentSessionId();
        logDebug(`Daemon started (pid ${process.pid}, session ${sessionId ?? "none"})`);
        // Run once immediately — scheduleNextSync is called in the finally block
        await syncLoop();
    }
    catch (err) {
        logDebug(`Daemon fatal error: ${err instanceof Error ? err.message : String(err)}`);
        removePidFile();
        release();
        releaseDaemonLock = null;
    }
}
//# sourceMappingURL=daemon.js.map