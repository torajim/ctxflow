import path from "node:path";
import fs from "node:fs";
import { simpleGit } from "simple-git";
import { ctxflowDir, getProjectRoot } from "./paths.js";
import { logDebug } from "./log.js";
const BRANCH = "ctxflow";
const SYNC_DIR = ".sync";
function syncGitDir() {
    return path.join(ctxflowDir(), SYNC_DIR);
}
function mainGit() {
    return simpleGit(getProjectRoot());
}
function syncGit() {
    return simpleGit({
        baseDir: ctxflowDir(),
        binary: "git",
    }).env("GIT_DIR", syncGitDir());
}
export async function isGitRepo() {
    try {
        await mainGit().revparse(["--git-dir"]);
        return true;
    }
    catch {
        return false;
    }
}
export async function initGitWithRemote(remoteUrl) {
    const git = mainGit();
    if (!(await isGitRepo())) {
        await git.init();
    }
    try {
        await git.addRemote("origin", remoteUrl);
    }
    catch {
        // Remote 'origin' may already exist — update it
        await git.remote(["set-url", "origin", remoteUrl]);
    }
}
export async function hasGitRemote() {
    try {
        const remotes = await mainGit().getRemotes();
        return remotes.length > 0;
    }
    catch {
        return false;
    }
}
async function hasSyncRemote() {
    try {
        const remotes = await syncGit().getRemotes();
        return remotes.length > 0;
    }
    catch {
        return false;
    }
}
export async function getRemoteUrl() {
    try {
        const remotes = await mainGit().getRemotes(true);
        const origin = remotes.find((r) => r.name === "origin");
        return origin?.refs?.fetch ?? null;
    }
    catch {
        return null;
    }
}
export async function ensureCtxflowBranch() {
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
            }
            catch {
                logDebug("Remote ctxflow branch does not exist yet");
            }
        }
    }
}
export async function syncPush(workerName, maxRetries = 3) {
    await ensureCtxflowBranch();
    const git = syncGit();
    // Stage only this worker's files
    const filesToStage = [
        `workers/${workerName}.json`,
        `context/${workerName}.md`,
    ];
    // Also stage any task files
    const tasksPath = path.join(ctxflowDir(), "tasks");
    if (fs.existsSync(tasksPath)) {
        const taskFiles = fs
            .readdirSync(tasksPath)
            .filter((f) => f.endsWith(".json"));
        for (const f of taskFiles) {
            filesToStage.push(`tasks/${f}`);
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
    if (status.staged.length === 0)
        return;
    await git.commit(`sync: ${workerName} @ ${new Date().toISOString()}`);
    // Push with retry (use sync repo's remote check)
    if (!(await hasSyncRemote()))
        return;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await git.push("origin", BRANCH);
            return;
        }
        catch (err) {
            logDebug(`push attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
            if (attempt < maxRetries - 1) {
                try {
                    await git.pull("origin", BRANCH, { "--rebase": null });
                }
                catch (pullErr) {
                    logDebug(`pull-rebase failed: ${pullErr instanceof Error ? pullErr.message : String(pullErr)}`);
                }
            }
        }
    }
    logDebug(`push failed after ${maxRetries} attempts`);
}
export async function syncPull() {
    await ensureCtxflowBranch();
    const git = syncGit();
    if (!(await hasSyncRemote()))
        return;
    try {
        await git.fetch("origin", BRANCH);
        // Use rebase instead of reset --hard to preserve local unpushed commits
        try {
            await git.rebase([`origin/${BRANCH}`]);
        }
        catch (rebaseErr) {
            logDebug(`rebase failed, aborting and using reset: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`);
            try {
                await git.rebase(["--abort"]);
            }
            catch {
                // Abort may fail if rebase wasn't in progress
            }
            // Fallback: since each worker owns their files, reset is safe as last resort
            await git.raw(["reset", "--hard", `origin/${BRANCH}`]);
        }
    }
    catch (err) {
        logDebug(`syncPull fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export async function fullSync(workerName) {
    await syncPush(workerName);
    await syncPull();
}
//# sourceMappingURL=sync.js.map