#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  getMe,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  getWorker,
  saveWorker,
  createWorker,
  listWorkers,
  getTaskParticipants,
  addFileChange,
  createSession,
  getSession,
  getCurrentSessionId,
  getCurrentSession,
  updateSessionDaemonPid,
  removeSession,
  listSessions,
} from "./core/task.js";
import { hasGitRemote, ensureCtxflowBranch, isGitRepo, initGitWithRemote } from "./core/sync.js";
import { generateContext } from "./core/context.js";
import {
  ensureDirs,
  daemonPidFile,
  contextFile,
} from "./core/paths.js";
import { installHooks, ensureGitignore } from "./hooks.js";

const program = new Command();

program
  .name("ctxflow")
  .description("Real-time context synchronization for collaborative vibe coding")
  .version("0.1.0");

// Default command: interactive flow
program
  .action(async () => {
    ensureDirs();

    // Ensure git repo with remote
    if (!(await isGitRepo())) {
      const remoteUrl = await promptInput(
        "Not a git repository. Enter remote repository URL: ",
      );
      if (!remoteUrl.trim()) {
        console.error(chalk.red("ctxflow requires a git remote."));
        process.exit(1);
      }
      await initGitWithRemote(remoteUrl.trim());
      console.log(chalk.dim(`git init + remote configured: ${remoteUrl.trim()}`));
    } else if (!(await hasGitRemote())) {
      const remoteUrl = await promptInput(
        "No git remote configured. Enter remote repository URL: ",
      );
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
              const statusColor =
                w.status === "working"
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
  });

// ctxflow start <description>
program
  .command("start")
  .description("Start a new task")
  .argument("<description...>", "Task description")
  .action(async (descParts: string[]) => {
    ensureDirs();
    const description = descParts.join(" ");

    // Ensure git setup
    await ensureGitSetup();

    const me = await ensureIdentity();
    await startNewTask(me, description);
  });

// ctxflow list
program
  .command("list")
  .description("List all active tasks and participants")
  .action(async () => {
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
      } else {
        for (const w of participants) {
          const ago = formatTimeAgo(new Date(w.last_heartbeat));
          const statusColor =
            w.status === "working"
              ? chalk.green
              : w.status === "idle"
                ? chalk.yellow
                : chalk.red;
          const sessionTag = chalk.dim(` [${w.session_id}]`);
          console.log(
            `    ${w.name}${sessionTag} (${statusColor(w.status)}, ${ago})`,
          );
        }
      }
      console.log();
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
    } else {
      console.log(`  Sessions: ${sessions.length}`);
      for (const s of sessions) {
        const task = getTask(s.task_id);
        const worker = getWorker(s.session_id);
        const status = worker?.status ?? "unknown";
        const statusColor = status === "working" ? chalk.green : status === "idle" ? chalk.yellow : chalk.red;
        console.log(`    ${s.session_id} - ${statusColor(status)} - "${task?.description ?? s.task_id}"`);
      }
      console.log();
    }
  });

// ctxflow stop
program
  .command("stop")
  .description("Stop current task")
  .option("--session <id>", "Session ID to stop")
  .action(async (opts: { session?: string }) => {
    ensureDirs();

    let sessionId = opts.session ?? getCurrentSessionId();

    // If no session specified, try to find one for this user
    if (!sessionId) {
      const me = getMe();
      if (!me) {
        console.error(chalk.red("No session found. Use --session <id> or set CTXFLOW_SESSION."));
        process.exit(1);
      }
      const sessions = listSessions();
      const mySessions = sessions.filter((s) => s.name === me);
      if (mySessions.length === 0) {
        console.error(chalk.red("No active session found."));
        process.exit(1);
      }
      if (mySessions.length === 1) {
        sessionId = mySessions[0].session_id;
      } else {
        console.log(chalk.yellow("Multiple active sessions found:"));
        for (const s of mySessions) {
          const task = getTask(s.task_id);
          console.log(`  ${s.session_id} - "${task?.description ?? s.task_id}"`);
        }
        console.error(chalk.red("Use --session <id> to specify which session to stop."));
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
      const othersActive = participants.some(
        (p) =>
          p.session_id !== sessionId &&
          (p.status === "working" || p.status === "idle"),
      );
      if (!othersActive) {
        updateTaskStatus(worker.task_id, "done");
      }
    }

    worker.status = "disconnected";
    worker.task_id = null;
    saveWorker(worker);

    // Remove session
    removeSession(sessionId);

    // Stop daemon if no other local sessions active
    stopDaemonIfIdle();

    console.log(chalk.yellow(`\nSession ${sessionId} stopped.\n`));
  });

// ctxflow join <task-id>
program
  .command("join")
  .description("Join an existing task")
  .argument("<task-id>", "Task ID to join")
  .action(async (taskId: string) => {
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
  });

// ctxflow cleanup
program
  .command("cleanup")
  .description("Remove disconnected workers and done tasks")
  .action(async () => {
    ensureDirs();
    let cleaned = 0;

    // Remove disconnected workers without active sessions
    const workers = listWorkers();
    const sessions = listSessions();
    const activeSessionIds = new Set(sessions.map((s) => s.session_id));

    for (const worker of workers) {
      if (worker.status === "disconnected" && !activeSessionIds.has(worker.session_id)) {
        try {
          fs.unlinkSync((await import("./core/paths.js")).workerFile(worker.session_id));
          cleaned++;
        } catch { /* ignore */ }
        // Clean context file too
        try {
          fs.unlinkSync((await import("./core/paths.js")).contextFile(worker.session_id));
        } catch { /* ignore */ }
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
            fs.unlinkSync((await import("./core/paths.js")).taskFile(task.id));
            cleaned++;
          } catch { /* ignore */ }
        }
      }
    }

    console.log(chalk.green(`Cleaned up ${cleaned} stale entries.`));
  });

// ctxflow context
program
  .command("context")
  .description("Generate collaboration context")
  .option("--format <format>", "Output format (hook|text)", "text")
  .action(async (opts: { format: string }) => {
    ensureDirs();
    const sessionId = getCurrentSessionId();
    const context = generateContext(sessionId, opts.format as "hook" | "text");
    process.stdout.write(context);
  });

// ctxflow on-edit
program
  .command("on-edit")
  .description("Handle file edit event")
  .option("--file <filepath>", "Edited file path")
  .action(async (opts: { file?: string }) => {
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
      } catch {
        // Ignore parse errors
      }
    }

    if (!filePath || typeof filePath !== "string") return;

    // Reject null bytes
    if (filePath.includes("\0")) return;

    // Validate resolved path is within project root
    const resolvedPath = (await import("node:path")).default.resolve(filePath);
    const projectRoot = (await import("./core/paths.js")).getProjectRoot();
    const resolvedRoot = (await import("node:path")).default.resolve(projectRoot);
    if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) return;

    const sessionId = getCurrentSessionId();
    if (!sessionId) return;

    const filename = filePath.split("/").pop() ?? filePath;
    addFileChange(sessionId, filePath, `+modified ${filename}`);

    // Mark worker as actively working on file edit
    const worker = getWorker(sessionId);
    if (worker && worker.status !== "working") {
      worker.status = "working";
      saveWorker(worker);
    }
  });

// ctxflow on-session-end
program
  .command("on-session-end")
  .description("Handle session end")
  .action(async () => {
    ensureDirs();
    const sessionId = getCurrentSessionId();
    if (!sessionId) return;

    const worker = getWorker(sessionId);
    if (!worker) return;

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

// --- Shared task flows ---

async function ensureGitSetup(): Promise<void> {
  if (!(await isGitRepo())) {
    const remoteUrl = await promptInput(
      "Not a git repository. Enter remote repository URL: ",
    );
    if (!remoteUrl.trim()) {
      console.error(chalk.red("ctxflow requires a git remote."));
      process.exit(1);
    }
    await initGitWithRemote(remoteUrl.trim());
    console.log(chalk.dim(`git init + remote configured: ${remoteUrl.trim()}`));
  } else if (!(await hasGitRemote())) {
    const remoteUrl = await promptInput(
      "No git remote configured. Enter remote repository URL: ",
    );
    if (!remoteUrl.trim()) {
      console.error(chalk.red("ctxflow requires a git remote."));
      process.exit(1);
    }
    await initGitWithRemote(remoteUrl.trim());
    console.log(chalk.dim(`Remote configured: ${remoteUrl.trim()}`));
  }
}

async function ensureIdentity(): Promise<string> {
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

async function startNewTask(me: string, description: string): Promise<void> {
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

  console.log(chalk.green(`\nTask started: ${description}`));
  console.log(chalk.dim(`Task ID: ${task.id}`));
  console.log(chalk.dim(`Session: ${session.session_id}`));
  console.log(chalk.dim(`Worker: ${me}\n`));
  printSessionInstructions(session.session_id);
}

async function joinExistingTask(
  me: string,
  taskId: string,
  taskDescription: string,
): Promise<void> {
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

  console.log(chalk.green(`\nJoined task: ${taskDescription}`));
  console.log(chalk.dim(`Task ID: ${taskId}`));
  console.log(chalk.dim(`Session: ${session.session_id}`));
  console.log(chalk.dim(`Worker: ${me}\n`));
  printSessionInstructions(session.session_id);
}

function printSessionInstructions(sessionId: string): void {
  console.log(chalk.cyan("To enable session tracking in Claude Code, run:"));
  console.log(chalk.white(`  export CTXFLOW_SESSION=${sessionId}`));
  console.log(chalk.cyan("Then start Claude Code:"));
  console.log(chalk.white("  claude\n"));
}

// --- Helpers ---

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function promptInput(prompt: string): Promise<string> {
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

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    let resolved = false;
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      if (!resolved) {
        resolved = true;
        resolve(data);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(data);
      }
    }, 100);
  });
}

function startDaemonForSession(sessionId: string): void {
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
        } catch {
          // Process is dead — clean up stale PID file
          try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
        }
      }
    }
  } catch {
    // PID file read failed — proceed to start daemon
  }

  const daemonProcess = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "daemon"],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CTXFLOW_SESSION: sessionId },
    },
  );
  daemonProcess.unref();

  if (daemonProcess.pid) {
    // The daemon itself will acquire its lock file for true mutual exclusion.
    // This PID write is best-effort for quick checks.
    fs.writeFileSync(pidFile, String(daemonProcess.pid));
    updateSessionDaemonPid(sessionId, daemonProcess.pid);
  }
}

function stopDaemonIfIdle(): void {
  const pidFile = daemonPidFile();
  if (!fs.existsSync(pidFile)) return;

  const sessions = listSessions();
  if (sessions.length > 0) return;

  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    if (!isNaN(pid)) {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process already gone
  }
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // Already removed
  }
}
