import path from "node:path";
import fs from "node:fs";
import { simpleGit } from "simple-git";
import { ctxflowDir, getProjectRoot } from "./paths.js";
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
export async function hasGitRemote() {
    try {
        const remotes = await mainGit().getRemotes();
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
                // Branch doesn't exist remotely yet — that's fine
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
    // Push with retry
    const hasRemote = await hasGitRemote();
    if (!hasRemote)
        return;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await git.push("origin", BRANCH);
            return;
        }
        catch {
            if (attempt < maxRetries - 1) {
                try {
                    await git.pull("origin", BRANCH, { "--rebase": null });
                }
                catch {
                    // Pull failed too — retry anyway
                }
            }
        }
    }
}
export async function syncPull() {
    await ensureCtxflowBranch();
    const git = syncGit();
    const hasRemote = await hasGitRemote();
    if (!hasRemote)
        return;
    try {
        await git.fetch("origin", BRANCH);
        await git.raw(["reset", "--hard", `origin/${BRANCH}`]);
    }
    catch {
        // Remote branch may not exist yet
    }
}
export async function fullSync(workerName) {
    await syncPull();
    await syncPush(workerName);
}
//# sourceMappingURL=sync.js.map