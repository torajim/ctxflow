import path from "node:path";
import fs from "node:fs";
function sanitizeId(id) {
    // Allow only alphanumeric, dash, underscore (nanoid chars)
    if (!id || !/^[\w-]+$/.test(id)) {
        throw new Error(`Invalid ID: ${id}`);
    }
    if (id.length > 128) {
        throw new Error(`ID too long (max 128 chars): ${id}`);
    }
    return id;
}
/**
 * Resolve a path using realpathSync where possible, falling back to path.resolve.
 * On macOS /var → /private/var, so both sides must be resolved consistently.
 */
function resolveReal(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return path.resolve(p);
    }
}
/**
 * Validate that a resolved path is inside the expected parent directory.
 * Prevents symlink and traversal attacks.
 */
export function assertPathInside(filePath, parentDir) {
    const resolvedParent = resolveReal(parentDir);
    const resolvedFile = resolveReal(path.dirname(filePath));
    if (!resolvedFile.startsWith(resolvedParent + path.sep) && resolvedFile !== resolvedParent) {
        throw new Error(`Path escapes allowed directory: ${filePath}`);
    }
}
/**
 * Safe file write: validates the target is inside its expected directory before writing.
 */
export function safeWriteFile(filePath, parentDir, data) {
    fs.mkdirSync(parentDir, { recursive: true });
    assertPathInside(filePath, parentDir);
    const tmpPath = filePath + ".tmp." + process.pid + "." + Date.now();
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
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
export function lockDir() {
    return path.join(ctxflowDir(), "locks");
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
export function daemonLockFile() {
    return path.join(ctxflowDir(), "daemon.lock");
}
export function ensureDirs() {
    for (const dir of [ctxflowDir(), tasksDir(), workersDir(), contextDir(), sessionsDir(), lockDir()]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
//# sourceMappingURL=paths.js.map