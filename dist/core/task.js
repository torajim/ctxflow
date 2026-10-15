import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { nanoid } from "nanoid";
import { TaskSchema, WorkerSchema, SessionSchema, } from "./schema.js";
import { taskFile, tasksDir, workerFile, workersDir, sessionFile, sessionsDir, currentSessionFile, bindingFile, bindingsDir, ctxflowDir, ensureDirs, getProjectRoot, safeWriteFile, } from "./paths.js";
import { withLock } from "./lock.js";
import { logDebug } from "./log.js";
import { loadConfig } from "./config.js";
// --- Atomic file write (with path safety) ---
function writeFileAtomic(filePath, parentDir, data) {
    safeWriteFile(filePath, parentDir, data);
}
// --- Identity (from git config) ---
export function getMe() {
    if (process.env.CTXFLOW_WORKER)
        return process.env.CTXFLOW_WORKER;
    try {
        const name = execFileSync("git", ["config", "user.name"], {
            cwd: getProjectRoot(),
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return name || null;
    }
    catch {
        return null;
    }
}
// --- Sessions ---
export function createSession(name, taskId, daemonPid = null) {
    ensureDirs();
    const sessionId = nanoid(8);
    const session = {
        session_id: sessionId,
        name,
        task_id: taskId,
        daemon_pid: daemonPid,
        created_at: new Date().toISOString(),
    };
    writeFileAtomic(sessionFile(sessionId), sessionsDir(), JSON.stringify(session, null, 2));
    return session;
}
export function getSession(sessionId) {
    try {
        const raw = JSON.parse(fs.readFileSync(sessionFile(sessionId), "utf-8"));
        return SessionSchema.parse(raw);
    }
    catch (err) {
        if (err instanceof SyntaxError) {
            logDebug(`corrupted session file for ${sessionId}: ${err.message}`);
        }
        return null;
    }
}
export function updateSessionDaemonPid(sessionId, pid) {
    withLock(`session-${sessionId}`, () => {
        const session = getSession(sessionId);
        if (!session)
            return;
        session.daemon_pid = pid;
        writeFileAtomic(sessionFile(sessionId), sessionsDir(), JSON.stringify(session, null, 2));
    });
}
export function listSessions() {
    try {
        const files = fs.readdirSync(sessionsDir()).filter((f) => f.endsWith(".json"));
        return files
            .map((f) => {
            try {
                const raw = JSON.parse(fs.readFileSync(`${sessionsDir()}/${f}`, "utf-8"));
                return SessionSchema.parse(raw);
            }
            catch (err) {
                if (err instanceof SyntaxError) {
                    logDebug(`corrupted session file ${f}: ${err.message}`);
                }
                return null;
            }
        })
            .filter((s) => s !== null);
    }
    catch {
        return [];
    }
}
export function removeSession(sessionId) {
    try {
        fs.unlinkSync(sessionFile(sessionId));
    }
    catch {
        // Already removed
    }
    removeBindingsFor(sessionId);
}
function readCurrentSessionFile() {
    try {
        return fs.readFileSync(currentSessionFile(), "utf-8").trim() || null;
    }
    catch {
        return null;
    }
}
function isValidClaudeSessionId(id) {
    return /^[\w-]{1,128}$/.test(id);
}
function readBinding(claudeSessionId) {
    try {
        return fs.readFileSync(bindingFile(claudeSessionId), "utf-8").trim() || null;
    }
    catch {
        return null;
    }
}
function isBoundToOtherClaudeSession(sessionId, claudeSessionId) {
    try {
        return fs.readdirSync(bindingsDir()).some((f) => f !== claudeSessionId && readBinding(f) === sessionId);
    }
    catch {
        return false;
    }
}
/** Bind a Claude Code session to a ctxflow session (overwrites any previous binding). */
export function bindClaudeSession(claudeSessionId, sessionId) {
    safeWriteFile(bindingFile(claudeSessionId), bindingsDir(), sessionId);
}
export function removeBindingsFor(sessionId) {
    try {
        for (const f of fs.readdirSync(bindingsDir())) {
            if (readBinding(f) === sessionId) {
                fs.unlinkSync(bindingFile(f));
            }
        }
    }
    catch {
        // Nothing bound
    }
}
/**
 * Resolve which ctxflow session the caller belongs to.
 *
 * Several terminals can share one project directory, so the project-wide
 * current-session file alone is ambiguous. Order:
 * 1. CTXFLOW_SESSION env var (explicit)
 * 2. Hooks pass the Claude Code session ID: use its binding, or claim the
 *    current-session file if no other Claude session has claimed it yet.
 * 3. CLI commands run inside Claude's Bash tool: the binding of
 *    CLAUDE_CODE_SESSION_ID, read-only.
 * 4. Otherwise: the current-session file.
 */
export function getCurrentSessionId(claudeSessionId) {
    if (process.env.CTXFLOW_SESSION)
        return process.env.CTXFLOW_SESSION;
    if (!claudeSessionId || !isValidClaudeSessionId(claudeSessionId)) {
        const envClaudeId = process.env.CLAUDE_CODE_SESSION_ID;
        if (envClaudeId && isValidClaudeSessionId(envClaudeId)) {
            const bound = readBinding(envClaudeId);
            if (bound && getSession(bound))
                return bound;
        }
        return readCurrentSessionFile();
    }
    const claudeId = claudeSessionId;
    const bound = readBinding(claudeId);
    if (bound) {
        if (getSession(bound))
            return bound;
        try {
            fs.unlinkSync(bindingFile(claudeId));
        }
        catch { /* ignore */ }
    }
    const current = readCurrentSessionFile();
    if (!current || !getSession(current))
        return null;
    if (isBoundToOtherClaudeSession(current, claudeId))
        return null;
    bindClaudeSession(claudeId, current);
    return current;
}
export function writeCurrentSession(sessionId) {
    safeWriteFile(currentSessionFile(), ctxflowDir(), sessionId);
}
export function clearCurrentSession(sessionId) {
    try {
        const current = fs.readFileSync(currentSessionFile(), "utf-8").trim();
        if (current === sessionId) {
            fs.unlinkSync(currentSessionFile());
        }
    }
    catch {
        // Already removed or unreadable
    }
}
export function getCurrentSession() {
    const sessionId = getCurrentSessionId();
    if (!sessionId)
        return null;
    return getSession(sessionId);
}
// --- Tasks ---
export function createTask(description, createdBy) {
    ensureDirs();
    const task = {
        id: nanoid(10),
        description,
        created_by: createdBy,
        created_at: new Date().toISOString(),
        status: "active",
    };
    writeFileAtomic(taskFile(task.id), tasksDir(), JSON.stringify(task, null, 2));
    return task;
}
export function getTask(id) {
    try {
        const raw = JSON.parse(fs.readFileSync(taskFile(id), "utf-8"));
        return TaskSchema.parse(raw);
    }
    catch (err) {
        if (err instanceof SyntaxError) {
            logDebug(`corrupted task file for ${id}: ${err.message}`);
        }
        return null;
    }
}
export function listTasks() {
    try {
        const files = fs.readdirSync(tasksDir()).filter((f) => f.endsWith(".json"));
        return files
            .map((f) => {
            try {
                const raw = JSON.parse(fs.readFileSync(`${tasksDir()}/${f}`, "utf-8"));
                return TaskSchema.parse(raw);
            }
            catch (err) {
                if (err instanceof SyntaxError) {
                    logDebug(`corrupted task file ${f}: ${err.message}`);
                }
                return null;
            }
        })
            .filter((t) => t !== null);
    }
    catch {
        return [];
    }
}
export function updateTaskStatus(id, status) {
    return withLock(`task-${id}`, () => {
        const task = getTask(id);
        if (!task)
            return null;
        task.status = status;
        writeFileAtomic(taskFile(id), tasksDir(), JSON.stringify(task, null, 2));
        return task;
    });
}
// --- Workers ---
export function getWorker(sessionId) {
    try {
        const raw = JSON.parse(fs.readFileSync(workerFile(sessionId), "utf-8"));
        return WorkerSchema.parse(raw);
    }
    catch (err) {
        if (err instanceof SyntaxError) {
            logDebug(`corrupted worker file for ${sessionId}: ${err.message}`);
        }
        return null;
    }
}
/**
 * A worker whose heartbeat is older than the inactivity threshold is reported as
 * disconnected. This is computed on read instead of written back, so a machine never
 * modifies another worker's file (which would make the shared branch conflict).
 */
function withEffectiveStatus(worker, thresholdMs, now) {
    if (worker.status !== "disconnected" &&
        now - new Date(worker.last_heartbeat).getTime() > thresholdMs) {
        return { ...worker, status: "disconnected" };
    }
    return worker;
}
export function listWorkers() {
    const thresholdMs = loadConfig().inactiveThresholdMs;
    const now = Date.now();
    return listStoredWorkers().map((w) => withEffectiveStatus(w, thresholdMs, now));
}
function listStoredWorkers() {
    try {
        const files = fs
            .readdirSync(workersDir())
            .filter((f) => f.endsWith(".json"));
        return files
            .map((f) => {
            try {
                const raw = JSON.parse(fs.readFileSync(`${workersDir()}/${f}`, "utf-8"));
                return WorkerSchema.parse(raw);
            }
            catch (err) {
                if (err instanceof SyntaxError) {
                    logDebug(`corrupted worker file ${f}: ${err.message}`);
                }
                return null;
            }
        })
            .filter((w) => w !== null);
    }
    catch {
        return [];
    }
}
export function saveWorker(worker) {
    ensureDirs();
    writeFileAtomic(workerFile(worker.session_id), workersDir(), JSON.stringify(worker, null, 2));
}
export function createWorker(name, machine, taskId, sessionId) {
    const now = new Date().toISOString();
    const worker = {
        name,
        session_id: sessionId,
        machine,
        task_id: taskId,
        joined_at: now,
        last_heartbeat: now,
        status: "working",
        files_touched: [],
    };
    saveWorker(worker);
    return worker;
}
export function updateHeartbeat(sessionId) {
    withLock(`worker-${sessionId}`, () => {
        const worker = getWorker(sessionId);
        if (!worker)
            return;
        worker.last_heartbeat = new Date().toISOString();
        saveWorker(worker);
    });
}
export function addFileChange(sessionId, filePath, summary) {
    const maxFiles = loadConfig().maxFilesTouched;
    // Normalize to relative path from project root to avoid leaking absolute paths
    let relativePath;
    if (path.isAbsolute(filePath)) {
        relativePath = path.relative(getProjectRoot(), filePath);
        // Skip paths that escape the project root
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath))
            return;
    }
    else {
        relativePath = filePath;
    }
    withLock(`worker-${sessionId}`, () => {
        const worker = getWorker(sessionId);
        if (!worker)
            return;
        const existing = worker.files_touched.find((f) => f.path === relativePath);
        if (existing) {
            existing.summary = summary;
            existing.updated_at = new Date().toISOString();
        }
        else {
            worker.files_touched.push({
                path: relativePath,
                summary,
                updated_at: new Date().toISOString(),
            });
        }
        if (worker.files_touched.length > maxFiles) {
            worker.files_touched = worker.files_touched.slice(-maxFiles);
        }
        saveWorker(worker);
    });
}
export function getTaskParticipants(taskId) {
    return listWorkers().filter((w) => w.task_id === taskId);
}
export function getActiveWorkers() {
    return listWorkers().filter((w) => w.status === "working" || w.status === "idle");
}
//# sourceMappingURL=task.js.map