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

async function commitLocalState(git: SimpleGit, sessionIds: string[]): Promise<void> {
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
}

export async function syncPush(sessionIds: string[]): Promise<void> {
  const config = loadConfig();
  const maxRetries = config.pushMaxRetries;
  const baseMs = config.pushRetryBaseMs;

  await ensureCtxflowBranch();
  const git = syncGit();

  await commitLocalState(git, sessionIds);

  if (!(await hasSyncRemote())) return;

  // Teammates push every few seconds too; integrate first so the push usually fast-forwards.
  await integrateRemote(git, sessionIds);
  // A reset during integration puts local state back as uncommitted files.
  await commitLocalState(git, sessionIds);
  if (!(await hasLocalCommits(git))) return;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await git.push("origin", `HEAD:refs/heads/${BRANCH}`);
      await compactHistoryIfNeeded(git, config.maxSyncCommits);
      return;
    } catch (err) {
      logDebug(`push attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
        await sleep(delay);
        await integrateRemote(git, sessionIds);
        await commitLocalState(git, sessionIds);
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

  // The remote history may have been compacted by a teammate; then there is nothing
  // to rebase onto and the remote state is taken directly.
  if (await sharesHistoryWithRemote(git)) {
    try {
      await git.rebase(["--autostash", `origin/${BRANCH}`]);
      return;
    } catch (rebaseErr) {
      logDebug(`rebase failed, resetting to remote and keeping owned files: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`);
      await git.rebase(["--abort"]).catch(() => undefined);
    }
  } else {
    logDebug("remote history was compacted, adopting it");
  }

  await resetToRemoteKeepingLocal(git, sessionIds);
}

async function sharesHistoryWithRemote(git: SimpleGit): Promise<boolean> {
  try {
    // No common ancestor exits 1 with empty output, which simple-git does not always treat as an error.
    return (await git.raw(["merge-base", "HEAD", `origin/${BRANCH}`])).trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Take the remote state wholesale, then put back what only this machine can know:
 * its own worker/context files, and tasks the remote does not have yet.
 */
async function resetToRemoteKeepingLocal(git: SimpleGit, sessionIds: string[]): Promise<void> {
  const read = (f: string): string | null => {
    try {
      return fs.readFileSync(path.join(ctxflowDir(), f), "utf-8");
    } catch {
      return null;
    }
  };
  const owned = new Map<string, string>();
  for (const f of ownedFiles(sessionIds)) {
    const content = read(f);
    if (content !== null) owned.set(f, content);
  }
  const localTasks = new Map<string, string>();
  const tasksPath = path.join(ctxflowDir(), "tasks");
  if (fs.existsSync(tasksPath)) {
    for (const name of fs.readdirSync(tasksPath).filter((n) => n.endsWith(".json"))) {
      const content = read(`tasks/${name}`);
      if (content !== null) localTasks.set(`tasks/${name}`, content);
    }
  }

  await git.raw(["reset", "--hard", `origin/${BRANCH}`]);

  const write = (f: string, content: string): void => {
    const full = path.join(ctxflowDir(), f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  for (const [f, content] of owned) write(f, content);
  for (const [f, content] of localTasks) {
    if (!fs.existsSync(path.join(ctxflowDir(), f))) write(f, content);
  }
}

/**
 * Every sync is a commit, so the shared branch grows without bound. Once it passes
 * the limit, replace it with a single commit holding the same files. The lease makes
 * this a no-op if a teammate pushed in between; teammates adopt the compacted branch
 * on their next sync (see integrateRemote).
 */
async function compactHistoryIfNeeded(git: SimpleGit, maxCommits: number): Promise<void> {
  const count = parseInt((await git.raw(["rev-list", "--count", "HEAD"])).trim(), 10);
  if (!(count > maxCommits)) return;

  const pushed = (await git.revparse(["HEAD"])).trim();
  const compacted = (
    await git.raw(["commit-tree", "HEAD^{tree}", "-m", `ctxflow: compact ${count} sync commits`])
  ).trim();
  try {
    await git.push([
      "origin",
      `${compacted}:refs/heads/${BRANCH}`,
      `--force-with-lease=refs/heads/${BRANCH}:${pushed}`,
    ]);
    await git.raw(["reset", "--soft", compacted]);
    await git.fetch("origin", BRANCH);
    logDebug(`compacted ${count} sync commits into ${compacted.slice(0, 8)}`);
  } catch (err) {
    logDebug(`history compaction skipped: ${err instanceof Error ? err.message : String(err)}`);
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
