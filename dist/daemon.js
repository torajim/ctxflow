import fs from "node:fs";
import { getMe, listWorkers, saveWorker, updateHeartbeat } from "./core/task.js";
import { hasGitRemote, ensureCtxflowBranch, fullSync } from "./core/sync.js";
import { daemonPidFile } from "./core/paths.js";
import { logDebug } from "./core/log.js";
const SYNC_INTERVAL_MS = 5_000;
const INACTIVE_THRESHOLD_MS = 60_000;
let intervalHandle = null;
function writePid() {
    fs.writeFileSync(daemonPidFile(), String(process.pid));
}
function removePidFile() {
    try {
        fs.unlinkSync(daemonPidFile());
    }
    catch {
        // Already removed, ignore
    }
}
function markInactiveWorkers() {
    const workers = listWorkers();
    const now = Date.now();
    for (const worker of workers) {
        if ((worker.status === "working" || worker.status === "idle") &&
            now - new Date(worker.last_heartbeat).getTime() > INACTIVE_THRESHOLD_MS) {
            saveWorker({ ...worker, status: "disconnected" });
            logDebug(`marked ${worker.name} as disconnected (heartbeat timeout)`);
        }
    }
}
async function syncLoop() {
    try {
        const me = getMe();
        if (!me)
            return;
        updateHeartbeat(me);
        if (!(await hasGitRemote()))
            return;
        await ensureCtxflowBranch();
        await fullSync(me);
        markInactiveWorkers();
    }
    catch (err) {
        logDebug(`sync error: ${err instanceof Error ? err.message : String(err)}`);
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
    removePidFile();
}
function gracefulShutdown() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    removePidFile();
    logDebug("Daemon stopped gracefully");
    process.exit(0);
}
export async function runDaemon() {
    if (isDaemonRunning()) {
        logDebug("Daemon already running, exiting.");
        return;
    }
    writePid();
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
    logDebug("Daemon started (pid " + process.pid + ")");
    // Run once immediately, then on interval
    await syncLoop();
    intervalHandle = setInterval(() => {
        syncLoop();
    }, SYNC_INTERVAL_MS);
}
//# sourceMappingURL=daemon.js.map