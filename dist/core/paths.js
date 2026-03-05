import path from "node:path";
import fs from "node:fs";
function sanitizeId(id) {
    const sanitized = path.basename(id);
    if (!sanitized || sanitized === "." || sanitized === "..") {
        throw new Error(`Invalid ID: ${id}`);
    }
    return sanitized;
}
let projectRoot = null;
export function setProjectRoot(root) {
    projectRoot = root;
}
export function getProjectRoot() {
    if (projectRoot)
        return projectRoot;
    return process.cwd();
}
export function ctxflowDir() {
    return path.join(getProjectRoot(), ".ctxflow");
}
export function tasksDir() {
    return path.join(ctxflowDir(), "tasks");
}
export function workersDir() {
    return path.join(ctxflowDir(), "workers");
}
export function contextDir() {
    return path.join(ctxflowDir(), "context");
}
export function sessionsDir() {
    return path.join(ctxflowDir(), "sessions");
}
export function workerFile(sessionId) {
    return path.join(workersDir(), `${sanitizeId(sessionId)}.json`);
}
export function taskFile(id) {
    return path.join(tasksDir(), `${sanitizeId(id)}.json`);
}
export function contextFile(sessionId) {
    return path.join(contextDir(), `${sanitizeId(sessionId)}.md`);
}
export function sessionFile(sessionId) {
    return path.join(sessionsDir(), `${sanitizeId(sessionId)}.json`);
}
export function daemonPidFile() {
    return path.join(ctxflowDir(), "daemon.pid");
}
export function ensureDirs() {
    for (const dir of [ctxflowDir(), tasksDir(), workersDir(), contextDir(), sessionsDir()]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
//# sourceMappingURL=paths.js.map