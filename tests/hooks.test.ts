import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot } from "../src/core/paths.js";
import { installHooks, ensureGitignore } from "../src/hooks.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-hooks-test-"));
  setProjectRoot(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("installHooks", () => {
  it("creates settings.local.json with hooks", () => {
    installHooks();

    const settingsFile = path.join(tmpDir, ".claude", "settings.local.json");
    expect(fs.existsSync(settingsFile)).toBe(true);

    const config = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    expect(config.hooks).toBeDefined();
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PostToolUse).toHaveLength(1);
    expect(config.hooks.Stop).toHaveLength(1);
  });

  it("PreToolUse hook calls ctxflow context", () => {
    installHooks();

    const settingsFile = path.join(tmpDir, ".claude", "settings.local.json");
    const config = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

    const preHook = config.hooks.PreToolUse[0];
    expect(preHook.matcher).toBe("");
    expect(preHook.hooks[0].command).toBe("ctxflow context --format hook");
    expect(preHook.hooks[0].timeout).toBe(5000);
  });

  it("PostToolUse hook matches Edit|Write|NotebookEdit", () => {
    installHooks();

    const settingsFile = path.join(tmpDir, ".claude", "settings.local.json");
    const config = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

    const postHook = config.hooks.PostToolUse[0];
    expect(postHook.matcher).toBe("Edit|Write|NotebookEdit");
    expect(postHook.hooks[0].command).toBe("ctxflow on-edit");
  });

  it("does not duplicate hooks on repeated installs", () => {
    installHooks();
    installHooks();
    installHooks();

    const settingsFile = path.join(tmpDir, ".claude", "settings.local.json");
    const config = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PostToolUse).toHaveLength(1);
    expect(config.hooks.Stop).toHaveLength(1);
  });

  it("preserves existing settings", () => {
    const settingsDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.local.json"),
      JSON.stringify({ customSetting: true, hooks: {} }, null, 2),
    );

    installHooks();

    const settingsFile = path.join(settingsDir, "settings.local.json");
    const config = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    expect(config.customSetting).toBe(true);
    expect(config.hooks.PreToolUse).toHaveLength(1);
  });

  it("preserves existing non-ctxflow hooks", () => {
    const settingsDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.local.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "echo existing", timeout: 3000 }] },
          ],
        },
      }, null, 2),
    );

    installHooks();

    const config = JSON.parse(fs.readFileSync(path.join(settingsDir, "settings.local.json"), "utf-8"));
    expect(config.hooks.PreToolUse).toHaveLength(2);
    expect(config.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(config.hooks.PreToolUse[1].hooks[0].command).toBe("ctxflow context --format hook");
  });
});

describe("ensureGitignore", () => {
  it("creates .gitignore with .ctxflow/ if none exists", () => {
    ensureGitignore();

    const gitignorePath = path.join(tmpDir, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf-8")).toContain(".ctxflow/");
  });

  it("appends .ctxflow/ to existing .gitignore", () => {
    const gitignorePath = path.join(tmpDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n");

    ensureGitignore();

    const content = fs.readFileSync(gitignorePath, "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".ctxflow/");
  });

  it("does not duplicate .ctxflow/ entry", () => {
    const gitignorePath = path.join(tmpDir, ".gitignore");
    fs.writeFileSync(gitignorePath, ".ctxflow/\n");

    ensureGitignore();

    const content = fs.readFileSync(gitignorePath, "utf-8");
    const matches = content.match(/\.ctxflow\//g);
    expect(matches).toHaveLength(1);
  });
});
