import path from "node:path";
import fs from "node:fs";
import { simpleGit, type SimpleGit } from "simple-git";
import { ctxflowDir, getProjectRoot } from "./paths.js";
import { logDebug } from "./log.js";
import { loadConfig } from "./config.js";

const BRANCH = "ctxflow";
const SYNC_DIR = ".sync";
const INIT_MARKER = "ctxflow-initialized";

// Local-only state that must never be committed to the shared branch.
const LOCAL_ONLY_PATTERNS = [
  `/${SYNC_DIR}/`,
  "/sessions/",
  "/bindings/",
  "/locks/",
  "/current-session",
  "/daemon.pid",
  "/daemon.lock/",
  "/debug.log*",
  "*.tmp.*",
];

function syncGitDir(): string {
  return path.join(ctxflowDir(), SYNC_DIR);
}

function mainGit(): SimpleGit {
  return simpleGit(getProjectRoot());
}

function syncGit(): SimpleGit {
  // simple-git's env() replaces the whole child environment, so PATH/HOME must be carried over.
  // GIT_WORK_TREE is required: with only GIT_DIR set, `git init` creates a bare repository.
  return simpleGit({ baseDir: ctxflowDir(), binary: "git" }).env({
    ...process.env,
    GIT_DIR: syncGitDir(),
    GIT_WORK_TREE: ctxflowDir(),
  });
}

export async function isGitRepo(): Promise<boolean> {
  try {
    await mainGit().revparse(["--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export async function initGitWithRemote(remoteUrl: string): Promise<void> {
  const git = mainGit();
  if (!(await isGitRepo())) {
    await git.init();
  }
  try {
    await git.addRemote("origin", remoteUrl);
  } catch {
    // Remote 'origin' may already exist — update it
    await git.remote(["set-url", "origin", remoteUrl]);
  }
}

export async function hasGitRemote(): Promise<boolean> {
  try {
    const remotes = await mainGit().getRemotes();
    return remotes.length > 0;
  } catch {
    return false;
  }
}

async function hasSyncRemote(): Promise<boolean> {
  try {
    const remotes = await syncGit().getRemotes();
    return remotes.length > 0;
  } catch {
    return false;
  }
}

export async function getRemoteUrl(): Promise<string | null> {
  try {
    const remotes = await mainGit().getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    return origin?.refs?.fetch ?? null;
  } catch {
    return null;
  }
}

async function hasLocalCommits(git: SimpleGit): Promise<boolean> {
  try {
    await git.revparse(["--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function remoteBranchExists(git: SimpleGit): Promise<boolean> {
  try {
    await git.revparse(["--verify", `refs/remotes/origin/${BRANCH}`]);
    return true;
  } catch {
    return false;
  }
}

async function initSyncRepo(): Promise<void> {
  const gitDir = syncGitDir();
  fs.mkdirSync(gitDir, { recursive: true });
  const git = syncGit();
  await git.init();
  await git.addConfig("core.bare", "false");
  await git.raw(["symbolic-ref", "HEAD", `refs/heads/${BRANCH}`]);
  // Sync commits are machine-generated; don't depend on the user's global identity.
  await git.addConfig("user.name", "ctxflow");
  await git.addConfig("user.email", "ctxflow@localhost");
  fs.mkdirSync(path.join(gitDir, "info"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "info", "exclude"), LOCAL_ONLY_PATTERNS.join("\n") + "\n");

  const remoteUrl = await getRemoteUrl();
  if (remoteUrl) {
    await git.addRemote("origin", remoteUrl);
    try {
      await git.fetch("origin", BRANCH);
      await adoptRemoteHistory(git);
    } catch {
      logDebug("Remote ctxflow branch does not exist yet");
    }
  }
  fs.writeFileSync(path.join(gitDir, INIT_MARKER), new Date().toISOString());
}

export async function ensureCtxflowBranch(): Promise<void> {
  const gitDir = syncGitDir();
  if (fs.existsSync(path.join(gitDir, INIT_MARKER))) return;

  // Missing marker means a fresh install or a previous init that failed halfway
  // (e.g. the bare repository created by older versions). Start over.
  fs.rmSync(gitDir, { recursive: true, force: true });
  try {
    await initSyncRepo();
  } catch (err) {
    fs.rmSync(gitDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Point the (still empty) local branch at origin/ctxflow without overwriting local files,
 * then materialize the files that only exist remotely (other workers' state).
 */
async function adoptRemoteHistory(git: SimpleGit): Promise<void> {
  await git.raw(["reset", `origin/${BRANCH}`]);
  const missing = (await git.raw(["ls-files", "--deleted"])).split("\n").filter(Boolean);
  if (missing.length > 0) {
    await git.raw(["checkout", "--", ...missing]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Files owned by the given sessions (relative to .ctxflow). Only their owner ever writes them. */
function ownedFiles(sessionIds: string[]): string[] {
  return sessionIds.flatMap((id) => [`workers/${id}.json`, `context/${id}.md`]);
}

export async function syncPush(sessionIds: string[]): Promise<void> {
  const config = loadConfig();
  const maxRetries = config.pushMaxRetries;
  const baseMs = config.pushRetryBaseMs;

  await ensureCtxflowBranch();
  const git = syncGit();

  const filesToStage = ownedFiles(sessionIds);
  const tasksPath = path.join(ctxflowDir(), "tasks");
  if (fs.existsSync(tasksPath)) {
    for (const f of fs.readdirSync(tasksPath).filter((f) => f.endsWith(".json"))) {
      filesToStage.push(`tasks/${f}`);
    }
  }

  const existing = filesToStage.filter((f) => fs.existsSync(path.join(ctxflowDir(), f)));
  if (existing.length > 0) {
    await git.add(existing);
  }

  const status = await git.status();
  if (status.staged.length > 0) {
    await git.commit(`sync: ${sessionIds.join(",")} @ ${new Date().toISOString()}`);
  }

  if (!(await hasSyncRemote())) return;

  // Teammates push every few seconds too; integrate first so the push usually fast-forwards.
  await integrateRemote(git, sessionIds);
  if (!(await hasLocalCommits(git))) return;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await git.push("origin", `HEAD:refs/heads/${BRANCH}`);
      return;
    } catch (err) {
      logDebug(`push attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
        await sleep(delay);
        await integrateRemote(git, sessionIds);
      }
    }
  }
  logDebug(`push failed after ${maxRetries} attempts`);
}

/**
 * Bring local branch up to date with origin/ctxflow.
 * Rebase first; if that fails, fall back to taking the remote state wholesale while
 * keeping the files this machine owns — nobody else writes them, so nothing is lost.
 */
async function integrateRemote(git: SimpleGit, sessionIds: string[]): Promise<void> {
  try {
    await git.fetch("origin", BRANCH);
  } catch (err) {
    logDebug(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!(await remoteBranchExists(git))) return;

  if (!(await hasLocalCommits(git))) {
    await adoptRemoteHistory(git);
    return;
  }

  try {
    await git.rebase(["--autostash", `origin/${BRANCH}`]);
    return;
  } catch (rebaseErr) {
    logDebug(`rebase failed, resetting to remote and keeping owned files: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`);
    await git.rebase(["--abort"]).catch(() => undefined);
  }

  const saved = new Map<string, string>();
  for (const f of ownedFiles(sessionIds)) {
    try {
      saved.set(f, fs.readFileSync(path.join(ctxflowDir(), f), "utf-8"));
    } catch {
      // Not created yet
    }
  }
  await git.raw(["reset", "--hard", `origin/${BRANCH}`]);
  for (const [f, content] of saved) {
    const full = path.join(ctxflowDir(), f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

export async function syncPull(sessionIds: string[] = []): Promise<void> {
  await ensureCtxflowBranch();
  if (!(await hasSyncRemote())) return;
  await integrateRemote(syncGit(), sessionIds);
}

/** Commit local state, integrate teammates' changes, and push. */
export async function fullSync(sessionIds: string[]): Promise<void> {
  await syncPush(sessionIds);
}
