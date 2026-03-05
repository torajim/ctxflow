import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { nanoid } from "nanoid";
import {
  TaskSchema,
  WorkerSchema,
  type Task,
  type Worker,
} from "./schema.js";
import {
  taskFile,
  tasksDir,
  workerFile,
  workersDir,
  ensureDirs,
  getProjectRoot,
} from "./paths.js";

const MAX_FILES_TOUCHED = 50;

// --- Atomic file write ---

function writeFileAtomic(filePath: string, data: string): void {
  const tmpPath = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

// --- Identity (from git config) ---

export function getMe(): string | null {
  try {
    const name = execFileSync("git", ["config", "user.name"], {
      cwd: getProjectRoot(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return name || null;
  } catch {
    return null;
  }
}

// --- Tasks ---

export function createTask(description: string, createdBy: string): Task {
  ensureDirs();
  const task: Task = {
    id: nanoid(10),
    description,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    status: "active",
  };
  writeFileAtomic(taskFile(task.id), JSON.stringify(task, null, 2));
  return task;
}

export function getTask(id: string): Task | null {
  try {
    const raw = JSON.parse(fs.readFileSync(taskFile(id), "utf-8"));
    return TaskSchema.parse(raw);
  } catch {
    return null;
  }
}

export function listTasks(): Task[] {
  try {
    const files = fs.readdirSync(tasksDir()).filter((f) => f.endsWith(".json"));
    return files
      .map((f) => {
        try {
          const raw = JSON.parse(
            fs.readFileSync(`${tasksDir()}/${f}`, "utf-8"),
          );
          return TaskSchema.parse(raw);
        } catch {
          return null;
        }
      })
      .filter((t): t is Task => t !== null);
  } catch {
    return [];
  }
}

export function updateTaskStatus(
  id: string,
  status: "active" | "done",
): Task | null {
  const task = getTask(id);
  if (!task) return null;
  task.status = status;
  writeFileAtomic(taskFile(id), JSON.stringify(task, null, 2));
  return task;
}

// --- Workers ---

export function getWorker(name: string): Worker | null {
  try {
    const raw = JSON.parse(fs.readFileSync(workerFile(name), "utf-8"));
    return WorkerSchema.parse(raw);
  } catch {
    return null;
  }
}

export function listWorkers(): Worker[] {
  try {
    const files = fs
      .readdirSync(workersDir())
      .filter((f) => f.endsWith(".json"));
    return files
      .map((f) => {
        try {
          const raw = JSON.parse(
            fs.readFileSync(`${workersDir()}/${f}`, "utf-8"),
          );
          return WorkerSchema.parse(raw);
        } catch {
          return null;
        }
      })
      .filter((w): w is Worker => w !== null);
  } catch {
    return [];
  }
}

export function saveWorker(worker: Worker): void {
  ensureDirs();
  writeFileAtomic(workerFile(worker.name), JSON.stringify(worker, null, 2));
}

export function createWorker(
  name: string,
  machine: string,
  taskId: string,
): Worker {
  const now = new Date().toISOString();
  const worker: Worker = {
    name,
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

export function updateHeartbeat(name: string): void {
  const worker = getWorker(name);
  if (!worker) return;
  worker.last_heartbeat = new Date().toISOString();
  saveWorker(worker);
}

export function addFileChange(
  workerName: string,
  filePath: string,
  summary: string,
): void {
  const worker = getWorker(workerName);
  if (!worker) return;
  const existing = worker.files_touched.find((f) => f.path === filePath);
  if (existing) {
    existing.summary = summary;
    existing.updated_at = new Date().toISOString();
  } else {
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

export function getTaskParticipants(taskId: string): Worker[] {
  return listWorkers().filter((w) => w.task_id === taskId);
}

export function getActiveWorkers(): Worker[] {
  return listWorkers().filter(
    (w) => w.status === "working" || w.status === "idle",
  );
}
