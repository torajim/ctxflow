import path from "node:path";
import fs from "node:fs";

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

export function meFile(): string {
  return path.join(ctxflowDir(), "me.json");
}

export function workerFile(name: string): string {
  return path.join(workersDir(), `${name}.json`);
}

export function taskFile(id: string): string {
  return path.join(tasksDir(), `${id}.json`);
}

export function contextFile(name: string): string {
  return path.join(contextDir(), `${name}.md`);
}

export function daemonPidFile(): string {
  return path.join(ctxflowDir(), "daemon.pid");
}

export function ensureDirs(): void {
  for (const dir of [ctxflowDir(), tasksDir(), workersDir(), contextDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
