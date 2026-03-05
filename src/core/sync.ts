import path from "node:path";
import fs from "node:fs";
import { simpleGit, type SimpleGit } from "simple-git";
import { ctxflowDir, getProjectRoot } from "./paths.js";
import { logDebug } from "./log.js";
import { loadConfig } from "./config.js";

const BRANCH = "ctxflow";
const SYNC_DIR = ".sync";

function syncGitDir(): string {
  return path.join(ctxflowDir(), SYNC_DIR);
}

function mainGit(): SimpleGit {
  return simpleGit(getProjectRoot());
}

function syncGit(): SimpleGit {
  return simpleGit({
    baseDir: ctxflowDir(),
    binary: "git",
  }).env("GIT_DIR", syncGitDir());
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

export async function ensureCtxflowBranch(): Promise<void> {
  const gitDir = syncGitDir();

  if (!fs.existsSync(gitDir)) {
    // Initialize bare-style git dir for sync
    fs.mkdirSync(gitDir, { recursive: true });
    const git = syncGit();
    await git.init();
    await git.raw(["checkout", "--orphan", BRANCH]);

    const remoteUrl = await getRemoteUrl();
    if (remoteUrl) {
      await git.addRemote("origin", remoteUrl);

      // Try to fetch existing ctxflow branch
      try {
        await git.fetch("origin", BRANCH);
        await git.raw(["reset", `origin/${BRANCH}`]);
      } catch {
        logDebug("Remote ctxflow branch does not exist yet");
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncPush(sessionId: string): Promise<void> {
  const config = loadConfig();
  const maxRetries = config.pushMaxRetries;
  const baseMs = config.pushRetryBaseMs;

  await ensureCtxflowBranch();
  const git = syncGit();

  // Stage only this worker's files (keyed by session ID)
  const filesToStage = [
    `workers/${sessionId}.json`,
    `context/${sessionId}.md`,
  ];

  // Also stage any task files and session files
  for (const subdir of ["tasks", "sessions"]) {
    const dirPath = path.join(ctxflowDir(), subdir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        filesToStage.push(`${subdir}/${f}`);
      }
    }
  }

  // Only add files that actually exist
  for (const f of filesToStage) {
    const fullPath = path.join(ctxflowDir(), f);
    if (fs.existsSync(fullPath)) {
      await git.add(f);
    }
  }

  // Check if there's anything to commit
  const status = await git.status();
  if (status.staged.length === 0) return;

  await git.commit(`sync: ${sessionId} @ ${new Date().toISOString()}`);

  if (!(await hasSyncRemote())) return;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await git.push("origin", BRANCH);
      return;
    } catch (err) {
      logDebug(`push attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
        await sleep(delay);
        try {
          await git.pull("origin", BRANCH, { "--rebase": null });
        } catch (pullErr) {
          logDebug(`pull-rebase failed: ${pullErr instanceof Error ? pullErr.message : String(pullErr)}`);
        }
      }
    }
  }
  logDebug(`push failed after ${maxRetries} attempts`);
}

export async function syncPull(): Promise<void> {
  await ensureCtxflowBranch();
  const git = syncGit();

  if (!(await hasSyncRemote())) return;

  try {
    await git.fetch("origin", BRANCH);
    try {
      await git.rebase([`origin/${BRANCH}`]);
    } catch (rebaseErr) {
      logDebug(`rebase failed, aborting and using reset: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`);
      try {
        await git.rebase(["--abort"]);
      } catch {
        // Abort may fail if rebase wasn't in progress
      }
      // Stash any local changes before reset to prevent data loss
      try {
        await git.stash(["push", "-m", `ctxflow-backup-${Date.now()}`]);
        logDebug("stashed local changes before hard reset");
      } catch {
        // Nothing to stash
      }
      await git.raw(["reset", "--hard", `origin/${BRANCH}`]);
      // Try to restore stashed changes
      try {
        await git.stash(["pop"]);
      } catch (popErr) {
        logDebug(
          `WARNING: stash pop failed after reset — local changes saved in git stash. ` +
          `Run 'cd .ctxflow && GIT_DIR=.sync git stash list' to inspect. ` +
          `Error: ${popErr instanceof Error ? popErr.message : String(popErr)}`,
        );
      }
    }
  } catch (err) {
    logDebug(`syncPull fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fullSync(sessionId: string): Promise<void> {
  await syncPush(sessionId);
  await syncPull();
}
