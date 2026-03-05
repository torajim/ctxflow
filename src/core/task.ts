import fs from "node:fs";
import os from "node:os";
import { nanoid } from "nanoid";
import {
  TaskSchema,
  WorkerSchema,
  MeSchema,
  type Task,
  type Worker,
} from "./schema.js";
import {
  meFile,
  taskFile,
  tasksDir,
  workerFile,
  workersDir,
  ensureDirs,
} from "./paths.js";

// --- Identity ---

export function getMe(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(meFile(), "utf-8"));
    return MeSchema.parse(raw).name;
  } catch {
    return null;
  }
}

export function setMe(name: string): void {
  ensureDirs();
  fs.writeFileSync(meFile(), JSON.stringify({ name }, null, 2));
}

export function getMeOrDefault(): string {
  return getMe() ?? os.hostname();
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
  fs.writeFileSync(taskFile(task.id), JSON.stringify(task, null, 2));
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
  fs.writeFileSync(taskFile(id), JSON.stringify(task, null, 2));
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
  fs.writeFileSync(workerFile(worker.name), JSON.stringify(worker, null, 2));
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
    status: "idle",
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
