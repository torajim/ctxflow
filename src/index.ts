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
  listTasks,
  getWorker,
  saveWorker,
  createWorker,
  listWorkers,
  getTaskParticipants,
  updateHeartbeat,
  addFileChange,
} from "./core/task.js";
import { hasGitRemote, fullSync, ensureCtxflowBranch, isGitRepo, initGitWithRemote } from "./core/sync.js";
import { generateContext } from "./core/context.js";
import {
  ensureDirs,
  daemonPidFile,
  workerFile,
  contextFile,
} from "./core/paths.js";
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

    console.log(chalk.bold("\nctxflow - 협업 상태\n"));

    const activeTasks = tasks.filter((t) => t.status === "active");
    if (activeTasks.length === 0) {
      console.log(chalk.gray("  활성 작업이 없습니다."));
      console.log(chalk.gray('  "ctxflow start <설명>" 으로 새 작업을 시작하세요.\n'));
      return;
    }

    console.log(chalk.bold("작업 목록:"));
    for (const task of activeTasks) {
      const participants = getTaskParticipants(task.id);
      console.log(`  ${task.description} (${chalk.dim(task.id)})`);

      if (participants.length === 0) {
        console.log(chalk.gray("    참여자 없음"));
      } else {
        for (const w of participants) {
          const ago = formatTimeAgo(new Date(w.last_heartbeat));
          const statusColor =
            w.status === "working"
              ? chalk.green
              : w.status === "idle"
                ? chalk.yellow
                : chalk.red;
          console.log(
            `    ${w.name} (${statusColor(w.status)}, ${ago})`,
          );
        }
      }
      console.log();
    }
  });

// ctxflow start <description>
program
  .command("start")
  .description("새 작업을 시작합니다")
  .argument("<description...>", "작업 설명")
  .action(async (descParts: string[]) => {
    ensureDirs();
    const description = descParts.join(" ");

    // Ensure git repo with remote
    if (!(await isGitRepo())) {
      const remoteUrl = await promptInput(
        "Git 저장소가 아닙니다. remote repository URL을 입력하세요: ",
      );
      if (!remoteUrl.trim()) {
        console.error(chalk.red("ctxflow는 git remote가 필요합니다."));
        process.exit(1);
      }
      await initGitWithRemote(remoteUrl.trim());
      console.log(chalk.dim(`git init + remote 설정 완료: ${remoteUrl.trim()}`));
    } else if (!(await hasGitRemote())) {
      const remoteUrl = await promptInput(
        "Git remote가 설정되지 않았습니다. remote repository URL을 입력하세요: ",
      );
      if (!remoteUrl.trim()) {
        console.error(chalk.red("ctxflow는 git remote가 필요합니다."));
        process.exit(1);
      }
      await initGitWithRemote(remoteUrl.trim());
      console.log(chalk.dim(`remote 설정 완료: ${remoteUrl.trim()}`));
    }

    // Get identity from git config
    const me = getMe();
    if (!me) {
      console.error(
        chalk.red(
          "git user.name이 설정되지 않았습니다.\n" +
            '  git config user.name "이름" 으로 설정하세요.',
        ),
      );
      process.exit(1);
    }

    // Check if already participating in a task
    const existingWorker = getWorker(me);
    if (existingWorker && existingWorker.task_id) {
      console.error(
        chalk.red(
          `이미 작업에 참여 중입니다: ${existingWorker.task_id}\n먼저 "ctxflow stop"으로 현재 작업을 중단하세요.`,
        ),
      );
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

    console.log(chalk.green(`\n작업 시작: ${description}`));
    console.log(chalk.dim(`작업 ID: ${task.id}`));
    console.log(chalk.dim(`참여자: ${me}\n`));
  });

// ctxflow stop
program
  .command("stop")
  .description("현재 작업을 중단합니다")
  .action(async () => {
    ensureDirs();
    const me = getMe();
    if (!me) {
      console.error(chalk.red("먼저 ctxflow start로 작업을 시작하세요."));
      process.exit(1);
    }

    const worker = getWorker(me);
    if (!worker) {
      console.error(chalk.red("활성 워커가 없습니다."));
      process.exit(1);
    }

    worker.status = "disconnected";
    worker.task_id = null;
    saveWorker(worker);

    // Stop daemon if no other local workers active
    stopDaemonIfIdle();

    console.log(chalk.yellow("\n작업을 중단했습니다.\n"));
  });

// ctxflow context
program
  .command("context")
  .description("컨텍스트를 생성합니다")
  .option("--format <format>", "출력 형식 (hook|text)", "text")
  .action(async (opts: { format: string }) => {
    ensureDirs();
    const me = getMe();
    const context = generateContext(me ?? "unknown", opts.format as "hook" | "text");
    process.stdout.write(context);
  });

// ctxflow on-edit
program
  .command("on-edit")
  .description("파일 편집 이벤트를 처리합니다")
  .option("--file <filepath>", "편집된 파일 경로")
  .action(async (opts: { file?: string }) => {
    ensureDirs();

    let filePath = opts.file;

    // Read stdin for PostToolUse hook input
    if (!filePath) {
      try {
        const input = await readStdin();
        if (input) {
          const parsed = JSON.parse(input);
          // PostToolUse provides tool_input with file_path or file
          filePath =
            parsed?.tool_input?.file_path ??
            parsed?.tool_input?.file ??
            parsed?.tool_input?.path;
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (!filePath) return;

    const me = getMe();
    if (!me) return;

    const filename = filePath.split("/").pop() ?? filePath;
    addFileChange(me, filePath, `+modified ${filename}`);
  });

// ctxflow on-session-end
program
  .command("on-session-end")
  .description("세션 종료를 처리합니다")
  .action(async () => {
    ensureDirs();
    const me = getMe();
    if (!me) return;

    const worker = getWorker(me);
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

// --- Helpers ---

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "방금 전";
  if (seconds < 60) return `${seconds}초 전`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 전`;
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
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    // Timeout after 1 second if no data
    setTimeout(() => resolve(data), 1000);
  });
}

function startDaemonIfNeeded(): void {
  const pidFile = daemonPidFile();
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0); // Check if process exists
      return; // Daemon already running
    } catch {
      // Process doesn't exist, clean up stale pid file
    }
  }

  const daemonProcess = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "daemon"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  daemonProcess.unref();

  if (daemonProcess.pid) {
    fs.writeFileSync(pidFile, String(daemonProcess.pid));
  }
}

function stopDaemonIfIdle(): void {
  const pidFile = daemonPidFile();
  if (!fs.existsSync(pidFile)) return;

  // Check if any other workers are active
  const workers = listWorkers();
  const activeWorkers = workers.filter(
    (w) => w.status === "working" && w.task_id,
  );
  if (activeWorkers.length > 0) return;

  const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already gone
  }
  fs.unlinkSync(pidFile);
}
