import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./core/paths.js";

interface HookEntry {
  type: string;
  command: string;
  timeout: number;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface HooksConfig {
  hooks?: {
    PreToolUse?: HookMatcher[];
    PostToolUse?: HookMatcher[];
    Stop?: HookMatcher[];
    SessionStart?: HookMatcher[];
    [key: string]: HookMatcher[] | undefined;
  };
  [key: string]: unknown;
}

// Claude Code hook timeouts are in seconds.
const HOOK_TIMEOUT_SECONDS = 10;

const CTXFLOW_HOOKS: HooksConfig["hooks"] = {
  SessionStart: [
    {
      matcher: "",
      hooks: [
        {
          type: "command",
          command: "ctxflow on-session-start",
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
  ],
  PreToolUse: [
    {
      matcher: "",
      hooks: [
        {
          type: "command",
          command: "ctxflow context --format hook",
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "Edit|Write|NotebookEdit",
      hooks: [
        {
          type: "command",
          command: "ctxflow on-edit",
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
  ],
  Stop: [
    {
      matcher: "",
      hooks: [
        {
          type: "command",
          command: "ctxflow on-session-end",
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
  ],
};

export function installHooks(): void {
  const settingsDir = path.join(getProjectRoot(), ".claude");
  const settingsFile = path.join(settingsDir, "settings.local.json");

  fs.mkdirSync(settingsDir, { recursive: true });

  let config: HooksConfig = {};
  if (fs.existsSync(settingsFile)) {
    const raw = fs.readFileSync(settingsFile, "utf-8");
    try {
      config = JSON.parse(raw) as HooksConfig;
    } catch {
      // Backup corrupted file before overwriting
      try {
        const backupFile = settingsFile + ".backup." + Date.now();
        fs.copyFileSync(settingsFile, backupFile);
      } catch {
        // If backup fails, log but continue — user still has the original on disk
      }
      config = {};
    }
  }

  if (!config.hooks) {
    config.hooks = {};
  }

  for (const [event, matchers] of Object.entries(CTXFLOW_HOOKS!)) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }
    for (const matcher of matchers as HookMatcher[]) {
      const existing = config.hooks[event]!.find(
        (e) =>
          e.matcher === matcher.matcher &&
          e.hooks.some((h) => matcher.hooks.some((mh) => mh.command === h.command)),
      );
      if (!existing) {
        config.hooks[event]!.push(matcher);
        continue;
      }
      // Older versions wrote timeouts in milliseconds (5000s in practice); fix them up.
      for (const h of existing.hooks) {
        const ours = matcher.hooks.find((mh) => mh.command === h.command);
        if (ours) h.timeout = ours.timeout;
      }
    }
  }

  // Atomic write to prevent corruption
  const tmpFile = settingsFile + ".tmp." + process.pid;
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmpFile, settingsFile);
}

export function ensureGitignore(): void {
  const gitignorePath = path.join(getProjectRoot(), ".gitignore");
  const entry = ".ctxflow/";

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (content.includes(entry)) return;
    fs.appendFileSync(gitignorePath, `\n${entry}\n`);
  } else {
    fs.writeFileSync(gitignorePath, `${entry}\n`);
  }
}
