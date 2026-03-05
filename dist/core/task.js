import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { nanoid } from "nanoid";
import { TaskSchema, WorkerSchema, SessionSchema, } from "./schema.js";
import { taskFile, tasksDir, workerFile, workersDir, sessionFile, sessionsDir, ensureDirs, getProjectRoot, } from "./paths.js";
const MAX_FILES_TOUCHED = 50;
// --- Atomic file write ---
function writeFileAtomic(filePath, data) {
    const tmpPath = filePath + ".tmp." + process.pid;
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
}
// --- Identity (from git config) ---
export function getMe() {
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
    writeFileAtomic(sessionFile(sessionId), JSON.stringify(session, null, 2));
    return session;
}
export function getSession(sessionId) {
    try {
        const raw = JSON.parse(fs.readFileSync(sessionFile(sessionId), "utf-8"));
        return SessionSchema.parse(raw);
    }
    catch {
        return null;
    }
}
export function updateSessionDaemonPid(sessionId, pid) {
    const session = getSession(sessionId);
    if (!session)
        return;
    session.daemon_pid = pid;
    writeFileAtomic(sessionFile(sessionId), JSON.stringify(session, null, 2));
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
            catch {
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
}
export function getCurrentSessionId() {
    return process.env.CTXFLOW_SESSION ?? null;
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
    writeFileAtomic(taskFile(task.id), JSON.stringify(task, null, 2));
    return task;
}
export function getTask(id) {
    try {
        const raw = JSON.parse(fs.readFileSync(taskFile(id), "utf-8"));
        return TaskSchema.parse(raw);
    }
    catch {
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
            catch {
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
    const task = getTask(id);
    if (!task)
        return null;
    task.status = status;
    writeFileAtomic(taskFile(id), JSON.stringify(task, null, 2));
    return task;
}
// --- Workers ---
export function getWorker(sessionId) {
    try {
        const raw = JSON.parse(fs.readFileSync(workerFile(sessionId), "utf-8"));
        return WorkerSchema.parse(raw);
    }
    catch {
        return null;
    }
}
export function listWorkers() {
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
            catch {
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
    writeFileAtomic(workerFile(worker.session_id), JSON.stringify(worker, null, 2));
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
    const worker = getWorker(sessionId);
    if (!worker)
        return;
    worker.last_heartbeat = new Date().toISOString();
    saveWorker(worker);
}
export function addFileChange(sessionId, filePath, summary) {
    const worker = getWorker(sessionId);
    if (!worker)
        return;
    const existing = worker.files_touched.find((f) => f.path === filePath);
    if (existing) {
        existing.summary = summary;
        existing.updated_at = new Date().toISOString();
    }
    else {
        worker.files_touched.push({
            path: filePath,
            summary,
            updated_at: new Date().toISOString(),
        });
    }
    // Prune old entries to prevent unbounded growth
    if (worker.files_touched.length > MAX_FILES_TOUCHED) {
        worker.files_touched = worker.files_touched.slice(-MAX_FILES_TOUCHED);
    }
    saveWorker(worker);
}
export function getTaskParticipants(taskId) {
    return listWorkers().filter((w) => w.task_id === taskId);
}
export function getActiveWorkers() {
    return listWorkers().filter((w) => w.status === "working" || w.status === "idle");
}
//# sourceMappingURL=task.js.map