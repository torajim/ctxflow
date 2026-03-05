import path from "node:path";
import fs from "node:fs";
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
export function meFile() {
    return path.join(ctxflowDir(), "me.json");
}
export function workerFile(name) {
    return path.join(workersDir(), `${name}.json`);
}
export function taskFile(id) {
    return path.join(tasksDir(), `${id}.json`);
}
export function contextFile(name) {
    return path.join(contextDir(), `${name}.md`);
}
export function daemonPidFile() {
    return path.join(ctxflowDir(), "daemon.pid");
}
export function ensureDirs() {
    for (const dir of [ctxflowDir(), tasksDir(), workersDir(), contextDir()]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
//# sourceMappingURL=paths.js.map