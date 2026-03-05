#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getMe, createTask, listTasks, getWorker, saveWorker, createWorker, listWorkers, getTaskParticipants, addFileChange, } from "./core/task.js";
import { hasGitRemote, isGitRepo, initGitWithRemote } from "./core/sync.js";
import { generateContext } from "./core/context.js";
import { ensureDirs, daemonPidFile, contextFile, } from "./core/paths.js";
import { installHooks, ensureGitignore } from "./hooks.js";
const program = new Command();
program
    .name("ctxflow")
    .description("Real-time context synchronization for collaborative vibe coding")
    .version("0.1.0");
// Default command: list active tasks with participants
program
    .action(async () => {
    ensureDirs();
    const tasks = listTasks();
    const workers = listWorkers();
    console.log(chalk.bold("\nctxflow - collaboration status\n"));
    const activeTasks = tasks.filter((t) => t.status === "active");
    if (activeTasks.length === 0) {
        console.log(chalk.gray("  No active tasks."));
        console.log(chalk.gray('  Run "ctxflow start <description>" to begin.\n'));
        return;
    }
    console.log(chalk.bold("Tasks:"));
    for (const task of activeTasks) {
        const participants = getTaskParticipants(task.id);
        console.log(`  ${task.description} (${chalk.dim(task.id)})`);
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
                console.log(`    ${w.name} (${statusColor(w.status)}, ${ago})`);
            }
        }
        console.log();
    }
});
// ctxflow start <description>
program
    .command("start")
    .description("Start a new task")
    .argument("<description...>", "Task description")
    .action(async (descParts) => {
    ensureDirs();
    const description = descParts.join(" ");
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
    // Get identity from git config
    let me = getMe();
    if (!me) {
        const name = await promptInput("git user.name is not set. Enter your name: ");
        if (!name.trim()) {
            console.error(chalk.red("A name is required to identify your work."));
            process.exit(1);
        }
        const { execSync } = await import("node:child_process");
        execSync(`git config user.name "${name.trim()}"`, { stdio: "pipe" });
        me = name.trim();
        console.log(chalk.dim(`git user.name set to "${me}"`));
    }
    // Check if already participating in a task
    const existingWorker = getWorker(me);
    if (existingWorker && existingWorker.task_id) {
        console.error(chalk.red(`Already participating in task: ${existingWorker.task_id}\nRun "ctxflow stop" first.`));
        process.exit(1);
    }
    // Create task
    const task = createTask(description, me);
    // Create or update worker
    const hostname = (await import("node:os")).hostname();
    const worker = createWorker(me, hostname, task.id);
    saveWorker(worker);
    // Create empty context file
    const ctxFile = contextFile(me);
    if (!fs.existsSync(ctxFile)) {
        fs.writeFileSync(ctxFile, "");
    }
    // Ensure .ctxflow/ is in .gitignore
    ensureGitignore();
    // Install Claude Code hooks
    installHooks();
    // Start daemon if not running
    startDaemonIfNeeded();
    console.log(chalk.green(`\nTask started: ${description}`));
    console.log(chalk.dim(`Task ID: ${task.id}`));
    console.log(chalk.dim(`Worker: ${me}\n`));
});
// ctxflow stop
program
    .command("stop")
    .description("Stop current task")
    .action(async () => {
    ensureDirs();
    const me = getMe();
    if (!me) {
        console.error(chalk.red("Run \"ctxflow start\" first."));
        process.exit(1);
    }
    const worker = getWorker(me);
    if (!worker) {
        console.error(chalk.red("No active worker found."));
        process.exit(1);
    }
    worker.status = "disconnected";
    worker.task_id = null;
    saveWorker(worker);
    // Stop daemon if no other local workers active
    stopDaemonIfIdle();
    console.log(chalk.yellow("\nTask stopped.\n"));
});
// ctxflow context
program
    .command("context")
    .description("Generate collaboration context")
    .option("--format <format>", "Output format (hook|text)", "text")
    .action(async (opts) => {
    ensureDirs();
    const me = getMe();
    const context = generateContext(me ?? "unknown", opts.format);
    process.stdout.write(context);
});
// ctxflow on-edit
program
    .command("on-edit")
    .description("Handle file edit event")
    .option("--file <filepath>", "Edited file path")
    .action(async (opts) => {
    ensureDirs();
    let filePath = opts.file;
    // Read stdin for PostToolUse hook input
    if (!filePath) {
        try {
            const input = await readStdin();
            if (input) {
                const parsed = JSON.parse(input);
                filePath =
                    parsed?.tool_input?.file_path ??
                        parsed?.tool_input?.file ??
                        parsed?.tool_input?.path;
            }
        }
        catch {
            // Ignore parse errors
        }
    }
    if (!filePath)
        return;
    const me = getMe();
    if (!me)
        return;
    const filename = filePath.split("/").pop() ?? filePath;
    addFileChange(me, filePath, `+modified ${filename}`);
});
// ctxflow on-session-end
program
    .command("on-session-end")
    .description("Handle session end")
    .action(async () => {
    ensureDirs();
    const me = getMe();
    if (!me)
        return;
    const worker = getWorker(me);
    if (!worker)
        return;
    worker.status = "idle";
    saveWorker(worker);
});
// ctxflow daemon (hidden)
program
    .command("daemon", { hidden: true })
    .action(async () => {
    const { runDaemon } = await import("./daemon.js");
    await runDaemon();
});
program.parse();
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
function readStdin() {
    return new Promise((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf-8");
        process.stdin.on("data", (chunk) => {
            data += chunk;
        });
        process.stdin.on("end", () => {
            resolve(data);
        });
        setTimeout(() => resolve(data), 1000);
    });
}
function startDaemonIfNeeded() {
    const pidFile = daemonPidFile();
    if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        try {
            process.kill(pid, 0);
            return;
        }
        catch {
            // Process doesn't exist, clean up stale pid file
        }
    }
    const daemonProcess = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon"], {
        detached: true,
        stdio: "ignore",
    });
    daemonProcess.unref();
    if (daemonProcess.pid) {
        fs.writeFileSync(pidFile, String(daemonProcess.pid));
    }
}
function stopDaemonIfIdle() {
    const pidFile = daemonPidFile();
    if (!fs.existsSync(pidFile))
        return;
    const workers = listWorkers();
    const activeWorkers = workers.filter((w) => w.status === "working" && w.task_id);
    if (activeWorkers.length > 0)
        return;
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    try {
        process.kill(pid, "SIGTERM");
    }
    catch {
        // Process already gone
    }
    fs.unlinkSync(pidFile);
}
//# sourceMappingURL=index.js.map