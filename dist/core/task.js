import fs from "node:fs";
import { execSync } from "node:child_process";
import { nanoid } from "nanoid";
import { TaskSchema, WorkerSchema, } from "./schema.js";
import { taskFile, tasksDir, workerFile, workersDir, ensureDirs, getProjectRoot, } from "./paths.js";
// --- Identity (from git config) ---
export function getMe() {
    try {
        const name = execSync("git config user.name", {
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
    fs.writeFileSync(taskFile(task.id), JSON.stringify(task, null, 2));
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
    fs.writeFileSync(taskFile(id), JSON.stringify(task, null, 2));
    return task;
}
// --- Workers ---
export function getWorker(name) {
    try {
        const raw = JSON.parse(fs.readFileSync(workerFile(name), "utf-8"));
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
    fs.writeFileSync(workerFile(worker.name), JSON.stringify(worker, null, 2));
}
export function createWorker(name, machine, taskId) {
    const now = new Date().toISOString();
    const worker = {
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
export function updateHeartbeat(name) {
    const worker = getWorker(name);
    if (!worker)
        return;
    worker.last_heartbeat = new Date().toISOString();
    saveWorker(worker);
}
export function addFileChange(workerName, filePath, summary) {
    const worker = getWorker(workerName);
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
    saveWorker(worker);
}
export function getTaskParticipants(taskId) {
    return listWorkers().filter((w) => w.task_id === taskId);
}
export function getActiveWorkers() {
    return listWorkers().filter((w) => w.status === "working" || w.status === "idle");
}
//# sourceMappingURL=task.js.map