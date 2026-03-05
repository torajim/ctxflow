import path from "node:path";
import fs from "node:fs";

function sanitizeId(id: string): string {
  const sanitized = path.basename(id);
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error(`Invalid ID: ${id}`);
  }
  return sanitized;
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

export function daemonPidFile(): string {
  return path.join(ctxflowDir(), "daemon.pid");
}

export function ensureDirs(): void {
  for (const dir of [ctxflowDir(), tasksDir(), workersDir(), contextDir(), sessionsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
