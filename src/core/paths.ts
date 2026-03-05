import path from "node:path";
import fs from "node:fs";

function sanitizeId(id: string): string {
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
function resolveReal(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Validate that a resolved path is inside the expected parent directory.
 * Prevents symlink and traversal attacks.
 */
export function assertPathInside(filePath: string, parentDir: string): void {
  const resolvedParent = resolveReal(parentDir);
  const resolvedFile = resolveReal(path.dirname(filePath));
  if (!resolvedFile.startsWith(resolvedParent + path.sep) && resolvedFile !== resolvedParent) {
    throw new Error(`Path escapes allowed directory: ${filePath}`);
  }
}

/**
 * Safe file write: validates the target is inside its expected directory before writing.
 */
export function safeWriteFile(filePath: string, parentDir: string, data: string): void {
  fs.mkdirSync(parentDir, { recursive: true });
  assertPathInside(filePath, parentDir);
  const tmpPath = filePath + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

let projectRoot: string | null = null;

export function setProjectRoot(root: string): void {
  projectRoot = root;
}

export function getProjectRoot(): string {
  if (projectRoot) return projectRoot;
  return process.cwd();
}

export function ctxflowDir(): string {
  return path.join(getProjectRoot(), ".ctxflow");
}

export function tasksDir(): string {
  return path.join(ctxflowDir(), "tasks");
}

export function workersDir(): string {
  return path.join(ctxflowDir(), "workers");
}

export function contextDir(): string {
  return path.join(ctxflowDir(), "context");
}

export function sessionsDir(): string {
  return path.join(ctxflowDir(), "sessions");
}

export function lockDir(): string {
  return path.join(ctxflowDir(), "locks");
}

export function workerFile(sessionId: string): string {
  return path.join(workersDir(), `${sanitizeId(sessionId)}.json`);
}

export function taskFile(id: string): string {
  return path.join(tasksDir(), `${sanitizeId(id)}.json`);
}

export function contextFile(sessionId: string): string {
  return path.join(contextDir(), `${sanitizeId(sessionId)}.md`);
}

export function sessionFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sanitizeId(sessionId)}.json`);
}

export function currentSessionFile(): string {
  return path.join(ctxflowDir(), "current-session");
}

export function daemonPidFile(): string {
  return path.join(ctxflowDir(), "daemon.pid");
}

export function daemonLockFile(): string {
  return path.join(ctxflowDir(), "daemon.lock");
}

export function ensureDirs(): void {
  for (const dir of [ctxflowDir(), tasksDir(), workersDir(), contextDir(), sessionsDir(), lockDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
