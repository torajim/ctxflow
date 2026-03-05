#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getMe, createTask, getTask, listTasks, updateTaskStatus, getWorker, saveWorker, createWorker, listWorkers, getTaskParticipants, addFileChange, createSession, getCurrentSessionId, updateSessionDaemonPid, removeSession, listSessions, writeCurrentSession, clearCurrentSession, } from "./core/task.js";
import { hasGitRemote, isGitRepo, initGitWithRemote } from "./core/sync.js";
import { generateContext } from "./core/context.js";
import path from "node:path";
import { ensureDirs, daemonPidFile, contextFile, getProjectRoot, } from "./core/paths.js";
import { installHooks, ensureGitignore } from "./hooks.js";
const program = new Command();
program
    .name("ctxflow")
    .description("Real-time context synchronization for collaborative vibe coding")
    .version("0.1.0");
// Default command: interactive flow
program
    .action(async () => {
    try {
        ensureDirs();
        // Ensure git repo with remote
        if (!(await isGitRepo())) {
            const remoteUrl = await promptInput("Not a git repository. Enter remote repository URL: ");
            if (!remoteUrl.trim()) {
                console.error(chalk.red("ctxflow requires a git remote."));
                process.exit(1);
            }
            await initGitWithRemote(remoteUrl.trim());
            console.log(chalk.dim(`git init + remote configured: ${remoteUrl.trim()}`));
        }
        else if (!(await hasGitRemote())) {
            const remoteUrl = await promptInput("No git remote configured. Enter remote repository URL: ");
            if (!remoteUrl.trim()) {
                console.error(chalk.red("ctxflow requires a git remote."));
                process.exit(1);
            }
            await initGitWithRemote(remoteUrl.trim());
            console.log(chalk.dim(`Remote configured: ${remoteUrl.trim()}`));
        }
        // Ensure identity
        let me = getMe();
        if (!me) {
            const name = await promptInput("git user.name is not set. Enter your name: ");
            if (!name.trim()) {
                console.error(chalk.red("A name is required to identify your work."));
                process.exit(1);
            }
            const { execFileSync } = await import("node:child_process");
            execFileSync("git", ["config", "user.name", name.trim()], { stdio: "pipe" });
            me = name.trim();
            console.log(chalk.dim(`git user.name set to "${me}"`));
        }
        const tasks = listTasks();
        const activeTasks = tasks.filter((t) => t.status === "active");
        console.log(chalk.bold("\nctxflow - collaboration status\n"));
        if (activeTasks.length === 0) {
            // No active tasks — prompt to create
            console.log(chalk.gray("  No active tasks.\n"));
            const desc = await promptInput("Create a new task (enter description): ");
            if (!desc.trim()) {
                console.log(chalk.gray("No task created.\n"));
                return;
            }
            await startNewTask(me, desc.trim());
            return;
        }
        // Show active tasks
        console.log(chalk.bold("Active tasks:"));
        for (let i = 0; i < activeTasks.length; i++) {
            const task = activeTasks[i];
            const participants = getTaskParticipants(task.id);
            const participantInfo = participants.length > 0
                ? participants
                    .map((w) => {
                    const ago = formatTimeAgo(new Date(w.last_heartbeat));
                    const statusColor = w.status === "working"
                        ? chalk.green
                        : w.status === "idle"
                            ? chalk.yellow
                            : chalk.red;
                    return `${w.name} (${statusColor(w.status)}, ${ago})`;
                })
                    .join(", ")
                : chalk.gray("no participants");
            console.log(`  ${chalk.white(`[${i + 1}]`)} ${task.description} ${chalk.dim(`(${task.id})`)}`);
            console.log(`      ${participantInfo}`);
        }
        console.log(`  ${chalk.white(`[N]`)} Create a new task`);
        console.log();
        const choice = await promptInput("Select a task to join, or N to create new: ");
        const trimmed = choice.trim().toLowerCase();
        if (trimmed === "n" || trimmed === "new") {
            const desc = await promptInput("Task description: ");
            if (!desc.trim()) {
                console.log(chalk.gray("No task created.\n"));
                return;
            }
            await startNewTask(me, desc.trim());
            return;
        }
        const idx = parseInt(trimmed, 10);
        if (isNaN(idx) || idx < 1 || idx > activeTasks.length) {
            console.error(chalk.red(`Invalid choice. Enter 1-${activeTasks.length} or N.`));
            process.exit(1);
        }
        const selectedTask = activeTasks[idx - 1];
        await joinExistingTask(me, selectedTask.id, selectedTask.description);
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
});
// ctxflow start <description>
program
    .command("start")
    .description("Start a new task")
    .argument("<description...>", "Task description")
    .action(async (descParts) => {
    try {
        ensureDirs();
        const description = descParts.join(" ");
        // Ensure git setup
        await ensureGitSetup();
        const me = await ensureIdentity();
        await startNewTask(me, description);
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
});
// ctxflow list
program
    .command("list")
    .description("List all active tasks and participants")
    .action(async () => {
    try {
        ensureDirs();
        const tasks = listTasks();
        const activeTasks = tasks.filter((t) => t.status === "active");
        console.log(chalk.bold("\nctxflow - active tasks\n"));
        if (activeTasks.length === 0) {
            console.log(chalk.gray("  No active tasks.\n"));
            return;
        }
        for (const task of activeTasks) {
            const participants = getTaskParticipants(task.id);
            console.log(`  ${task.description} ${chalk.dim(`(${task.id})`)}`);
            if (participants.length === 0) {
                console.log(chalk.gray("    no participants"));
            }
            else {
                for (const w of participants) {
                    const ago = formatTimeAgo(new Date(w.last_heartbeat));
                    const statusColor = w.status === "working"
                        ? chalk.green
                        : w.status === "idle"
                            ? chalk.yellow
                            : chalk.red;
                    const sessionTag = chalk.dim(` [${w.session_id}]`);
                    console.log(`    ${w.name}${sessionTag} (${statusColor(w.status)}, ${ago})`);
                }
            }
            console.log();
        }
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
});
// ctxflow status
program
    .command("status")
    .description("Show daemon and session status")
    .action(async () => {
    ensureDirs();
    const { isDaemonRunning } = await import("./daemon.js");
    const running = isDaemonRunning();
    console.log(chalk.bold("\nctxflow status\n"));
    console.log(`  Daemon: ${running ? chalk.green("running") : chalk.red("stopped")}`);
    const sessions = listSessions();
    if (sessions.length === 0) {
        console.log(chalk.gray("  No active sessions.\n"));
    }
    else {
        console.log(`  Sessions: ${sessions.length}`);
        for (const s of sessions) {
            const task = getTask(s.task_id);
            const worker = getWorker(s.session_id);
            const status = worker?.status ?? "unknown";
            const statusColor = status === "working" ? chalk.green : status === "idle" ? chalk.yellow : chalk.red;
            const name = worker?.name ?? s.name;
            console.log(`    ${s.session_id} (${name}) - ${statusColor(status)} - "${task?.description ?? s.task_id}"`);
        }
        console.log();
    }
});
// ctxflow stop
program
    .command("stop")
    .description("Stop current task")
    .option("--session <id>", "Session ID to stop")
    .action(async (opts) => {
    try {
        ensureDirs();
        let sessionId = opts.session ?? getCurrentSessionId();
        // Validate the session actually has a worker; if not, fall back
        if (sessionId && !getWorker(sessionId)) {
            sessionId = null;
        }
        // If no valid session, look at all active sessions
        if (!sessionId) {
            const sessions = listSessions();
            if (sessions.length === 0) {
                console.error(chalk.red("No active session found."));
                process.exit(1);
            }
            if (sessions.length === 1) {
                sessionId = sessions[0].session_id;
            }
            else {
                console.log(chalk.yellow("Multiple active sessions:"));
                for (const s of sessions) {
                    const worker = getWorker(s.session_id);
                    const task = getTask(s.task_id);
                    console.log(`  ${s.session_id} (${worker?.name ?? s.name}) - "${task?.description ?? s.task_id}"`);
                }
                console.error(chalk.red("\nUse: ctxflow stop --session <id>"));
                process.exit(1);
            }
        }
        const worker = getWorker(sessionId);
        if (!worker) {
            console.error(chalk.red(`No worker found for session: ${sessionId}`));
            process.exit(1);
        }
        // Mark task as done if no other active participants
        if (worker.task_id) {
            const participants = getTaskParticipants(worker.task_id);
            const othersActive = participants.some((p) => p.session_id !== sessionId &&
                (p.status === "working" || p.status === "idle"));
            if (!othersActive) {
                updateTaskStatus(worker.task_id, "done");
            }
        }
        worker.status = "disconnected";
        worker.task_id = null;
        saveWorker(worker);
        // Remove session
        removeSession(sessionId);
        clearCurrentSession(sessionId);
        // Stop daemon if no other local sessions active
        stopDaemonIfIdle();
        console.log(chalk.yellow(`\nSession ${sessionId} (${worker.name}) stopped.\n`));
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
});
// ctxflow join <task-id>
program
    .command("join")
    .description("Join an existing task")
    .argument("<task-id>", "Task ID to join")
    .action(async (taskId) => {
    try {
        ensureDirs();
        await ensureGitSetup();
        const task = getTask(taskId);
        if (!task) {
            console.error(chalk.red(`Task not found: ${taskId}`));
            process.exit(1);
        }
        if (task.status !== "active") {
            console.error(chalk.red(`Task is not active: ${taskId}`));
            process.exit(1);
        }
        const me = await ensureIdentity();
        await joinExistingTask(me, taskId, task.description);
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
});
// ctxflow cleanup
program
    .command("cleanup")
    .description("Remove disconnected workers and done tasks")
    .action(async () => {
    try {
        ensureDirs();
        let cleaned = 0;
        // Remove disconnected workers without active sessions
        const workers = listWorkers();
        const sessions = listSessions();
        const activeSessionIds = new Set(sessions.map((s) => s.session_id));
        const paths = await import("./core/paths.js");
        for (const worker of workers) {
            if (worker.status === "disconnected" && !activeSessionIds.has(worker.session_id)) {
                // Re-check worker status before deleting to avoid TOCTOU race
                const current = getWorker(worker.session_id);
                if (current && current.status === "disconnected") {
                    try {
                        fs.unlinkSync(paths.workerFile(worker.session_id));
                        cleaned++;
                    }
                    catch { /* ignore */ }
                    try {
                        fs.unlinkSync(paths.contextFile(worker.session_id));
                    }
                    catch { /* ignore */ }
                }
            }
        }
        // Remove done tasks with no active participants
        const tasks = listTasks();
        for (const task of tasks) {
            if (task.status === "done") {
                const participants = getTaskParticipants(task.id);
                const hasActive = participants.some((p) => p.status === "working" || p.status === "idle");
                if (!hasActive) {
                    try {
                        fs.unlinkSync(paths.taskFile(task.id));
                        cleaned++;
                    }
                    catch { /* ignore */ }
                }
            }
        }
        console.log(chalk.green(`Cleaned up ${cleaned} stale entries.`));
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
});
// ctxflow context
program
    .command("context")
    .description("Generate collaboration context")
    .option("--format <format>", "Output format (hook|text)", "text")
    .action(async (opts) => {
    try {
        ensureDirs();
        const sessionId = getCurrentSessionId();
        const context = generateContext(sessionId, opts.format);
        process.stdout.write(context);
    }
    catch {
        // Silently exit — cwd may not exist or no session active
    }
});
// ctxflow on-edit
program
    .command("on-edit")
    .description("Handle file edit event")
    .option("--file <filepath>", "Edited file path")
    .action(async (opts) => {
    try {
        ensureDirs();
        let filePath = opts.file;
        // Read stdin for PostToolUse hook input
        if (!filePath) {
            try {
                const input = await readStdin();
                if (input) { // Size already limited by readStdin()
                    const parsed = JSON.parse(input);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        const candidate = parsed?.tool_input?.file_path ??
                            parsed?.tool_input?.file ??
                            parsed?.tool_input?.path;
                        if (typeof candidate === "string") {
                            filePath = candidate;
                        }
                    }
                }
            }
            catch {
                // Ignore parse errors
            }
        }
        if (!filePath || typeof filePath !== "string")
            return;
        // Reject null bytes
        if (filePath.includes("\0"))
            return;
        // Validate resolved path is within project root (safe against symlinks and traversal)
        const nodePath = (await import("node:path")).default;
        const projectRoot = (await import("./core/paths.js")).getProjectRoot();
        const resolvedPath = nodePath.resolve(filePath);
        const resolvedRoot = nodePath.resolve(projectRoot);
        const relative = nodePath.relative(resolvedRoot, resolvedPath);
        if (relative.startsWith("..") || nodePath.isAbsolute(relative))
            return;
        const sessionId = getCurrentSessionId();
        if (!sessionId)
            return;
        const filename = filePath.split("/").pop() ?? filePath;
        addFileChange(sessionId, filePath, `+modified ${filename}`);
        // Mark worker as actively working on file edit
        const worker = getWorker(sessionId);
        if (worker && worker.status !== "working") {
            worker.status = "working";
            saveWorker(worker);
        }
    }
    catch {
        // Silently exit — cwd may not exist or no session active
    }
});
// ctxflow on-session-end
program
    .command("on-session-end")
    .description("Handle session end")
    .action(async () => {
    try {
        ensureDirs();
        const sessionId = getCurrentSessionId();
        if (!sessionId)
            return;
        const worker = getWorker(sessionId);
        if (!worker)
            return;
        worker.status = "idle";
        saveWorker(worker);
    }
    catch {
        // Silently exit — cwd may not exist or no session active
    }
});
// ctxflow debug-hooks
program
    .command("debug-hooks")
    .description("Test hook setup and output")
    .action(async () => {
    try {
        ensureDirs();
        const settingsFile = path.join(getProjectRoot(), ".claude", "settings.local.json");
        if (!fs.existsSync(settingsFile)) {
            console.log(chalk.red("✗ No .claude/settings.local.json found"));
            console.log(chalk.dim("  Run 'ctxflow start' or 'ctxflow join' to install hooks."));
            return;
        }
        console.log(chalk.green("✓ .claude/settings.local.json exists"));
        const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
        const preHooks = settings?.hooks?.PreToolUse;
        if (preHooks?.some((h) => h.hooks?.some((hh) => hh.command.includes("ctxflow context")))) {
            console.log(chalk.green("✓ PreToolUse hook installed"));
        }
        else {
            console.log(chalk.red("✗ PreToolUse hook not found"));
        }
        const sessionId = getCurrentSessionId();
        if (sessionId) {
            console.log(chalk.green(`✓ Current session: ${sessionId}`));
            const worker = getWorker(sessionId);
            if (worker) {
                console.log(chalk.green(`✓ Worker: ${worker.name} (${worker.status})`));
            }
            else {
                console.log(chalk.red(`✗ No worker found for session ${sessionId}`));
            }
        }
        else {
            console.log(chalk.yellow("⚠ No current session (hook will output nothing)"));
        }
        const sessions = listSessions();
        console.log(chalk.dim(`  Total sessions: ${sessions.length}`));
        console.log(chalk.cyan("\nHook output preview:"));
        const context = generateContext(sessionId, "hook");
        if (context) {
            console.log(chalk.white(context));
        }
        else {
            console.log(chalk.yellow("  (empty — no other active workers)"));
        }
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    }
});
// ctxflow daemon (hidden)
program
    .command("daemon", { hidden: true })
    .action(async () => {
    const { runDaemon } = await import("./daemon.js");
    await runDaemon();
});
program.parse();
// --- Shared task flows ---
async function ensureGitSetup() {
    if (!(await isGitRepo())) {
        const remoteUrl = await promptInput("Not a git repository. Enter remote repository URL: ");
        if (!remoteUrl.trim()) {
            console.error(chalk.red("ctxflow requires a git remote."));
            process.exit(1);
        }
        await initGitWithRemote(remoteUrl.trim());
        console.log(chalk.dim(`git init + remote configured: ${remoteUrl.trim()}`));
    }
    else if (!(await hasGitRemote())) {
        const remoteUrl = await promptInput("No git remote configured. Enter remote repository URL: ");
        if (!remoteUrl.trim()) {
            console.error(chalk.red("ctxflow requires a git remote."));
            process.exit(1);
        }
        await initGitWithRemote(remoteUrl.trim());
        console.log(chalk.dim(`Remote configured: ${remoteUrl.trim()}`));
    }
}
async function ensureIdentity() {
    let me = getMe();
    if (!me) {
        const name = await promptInput("git user.name is not set. Enter your name: ");
        if (!name.trim()) {
            console.error(chalk.red("A name is required to identify your work."));
            process.exit(1);
        }
        const { execFileSync } = await import("node:child_process");
        execFileSync("git", ["config", "user.name", name.trim()], { stdio: "pipe" });
        me = name.trim();
        console.log(chalk.dim(`git user.name set to "${me}"`));
    }
    return me;
}
async function startNewTask(me, description) {
    // Reuse existing session if still active
    const existingId = getCurrentSessionId();
    if (existingId) {
        const existingWorker = getWorker(existingId);
        if (existingWorker && existingWorker.name === me && existingWorker.status !== "disconnected") {
            console.log(chalk.yellow(`\nAlready in an active session: ${existingId} (${me})`));
            console.log(chalk.dim(`Run 'ctxflow stop' first to leave the current session.\n`));
            return;
        }
    }
    const task = createTask(description, me);
    const session = createSession(me, task.id);
    const hostname = (await import("node:os")).hostname();
    createWorker(me, hostname, task.id, session.session_id);
    const ctxFile = contextFile(session.session_id);
    if (!fs.existsSync(ctxFile)) {
        fs.writeFileSync(ctxFile, "");
    }
    ensureGitignore();
    installHooks();
    startDaemonForSession(session.session_id);
    writeCurrentSession(session.session_id);
    console.log(chalk.green(`\nTask started: ${description}`));
    console.log(chalk.dim(`Task ID: ${task.id}`));
    console.log(chalk.dim(`Session: ${session.session_id}`));
    console.log(chalk.dim(`Worker: ${me}\n`));
    printSessionInstructions(session.session_id);
}
async function joinExistingTask(me, taskId, taskDescription) {
    // Reuse existing session if still active for the same task
    const existingId = getCurrentSessionId();
    if (existingId) {
        const existingWorker = getWorker(existingId);
        if (existingWorker && existingWorker.name === me && existingWorker.status !== "disconnected") {
            if (existingWorker.task_id === taskId) {
                console.log(chalk.yellow(`\nAlready in this task: ${existingId} (${me})`));
                console.log(chalk.dim(`Session is still active. No action needed.\n`));
                return;
            }
            console.log(chalk.yellow(`\nAlready in an active session: ${existingId} (${me})`));
            console.log(chalk.dim(`Run 'ctxflow stop' first to leave the current session.\n`));
            return;
        }
    }
    const session = createSession(me, taskId);
    const hostname = (await import("node:os")).hostname();
    createWorker(me, hostname, taskId, session.session_id);
    const ctxFile = contextFile(session.session_id);
    if (!fs.existsSync(ctxFile)) {
        fs.writeFileSync(ctxFile, "");
    }
    ensureGitignore();
    installHooks();
    startDaemonForSession(session.session_id);
    writeCurrentSession(session.session_id);
    console.log(chalk.green(`\nJoined task: ${taskDescription}`));
    console.log(chalk.dim(`Task ID: ${taskId}`));
    console.log(chalk.dim(`Session: ${session.session_id}`));
    console.log(chalk.dim(`Worker: ${me}\n`));
    printSessionInstructions(session.session_id);
}
function printSessionInstructions(sessionId) {
    console.log(chalk.cyan("Session auto-saved. Hooks will pick it up automatically."));
    console.log(chalk.dim(`(or set manually: export CTXFLOW_SESSION=${sessionId})\n`));
}
// --- Helpers ---
function formatTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 10)
        return "just now";
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}
function promptInput(prompt) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}
const STDIN_MAX_BYTES = 1_048_576; // 1MB
function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) {
            resolve("");
            return;
        }
        let data = "";
        let resolved = false;
        process.stdin.setEncoding("utf-8");
        const finish = (result) => {
            if (resolved)
                return;
            resolved = true;
            process.stdin.removeListener("data", onData);
            process.stdin.removeListener("end", onEnd);
            resolve(result);
        };
        const onData = (chunk) => {
            data += chunk;
            if (data.length > STDIN_MAX_BYTES) {
                finish(""); // Reject oversized input
            }
        };
        const onEnd = () => {
            finish(data);
        };
        process.stdin.on("data", onData);
        process.stdin.on("end", onEnd);
        setTimeout(() => finish(data), 100);
    });
}
function startDaemonForSession(sessionId) {
    const pidFile = daemonPidFile();
    // Check if daemon already running
    try {
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
            if (!isNaN(pid)) {
                try {
                    process.kill(pid, 0);
                    // Daemon is alive — no need to start another
                    return;
                }
                catch {
                    // Process is dead — clean up stale PID file
                    try {
                        fs.unlinkSync(pidFile);
                    }
                    catch { /* ignore */ }
                }
            }
        }
    }
    catch {
        // PID file read failed — proceed to start daemon
    }
    const daemonProcess = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon"], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, CTXFLOW_SESSION: sessionId },
    });
    daemonProcess.unref();
    if (daemonProcess.pid) {
        // The daemon itself will acquire its lock file for true mutual exclusion.
        // This PID write is best-effort for quick checks.
        fs.writeFileSync(pidFile, String(daemonProcess.pid));
        updateSessionDaemonPid(sessionId, daemonProcess.pid);
    }
}
function stopDaemonIfIdle() {
    const pidFile = daemonPidFile();
    if (!fs.existsSync(pidFile))
        return;
    const sessions = listSessions();
    if (sessions.length > 0)
        return;
    try {
        const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
            process.kill(pid, "SIGTERM");
        }
    }
    catch {
        // Process already gone
    }
    try {
        fs.unlinkSync(pidFile);
    }
    catch {
        // Already removed
    }
}
//# sourceMappingURL=index.js.map