import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./core/paths.js";
const CTXFLOW_HOOKS = {
    PreToolUse: [
        {
            matcher: "",
            hooks: [
                {
                    type: "command",
                    command: "ctxflow context --format hook",
                    timeout: 5000,
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
                    timeout: 5000,
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
                    timeout: 5000,
                },
            ],
        },
    ],
};
export function installHooks() {
    const settingsDir = path.join(getProjectRoot(), ".claude");
    const settingsFile = path.join(settingsDir, "settings.local.json");
    fs.mkdirSync(settingsDir, { recursive: true });
    let config = {};
    if (fs.existsSync(settingsFile)) {
        const raw = fs.readFileSync(settingsFile, "utf-8");
        config = JSON.parse(raw);
    }
    if (!config.hooks) {
        config.hooks = {};
    }
    for (const [event, matchers] of Object.entries(CTXFLOW_HOOKS)) {
        if (!config.hooks[event]) {
            config.hooks[event] = [];
        }
        for (const matcher of matchers) {
            const exists = config.hooks[event].some((existing) => existing.matcher === matcher.matcher &&
                existing.hooks.some((h) => matcher.hooks.some((mh) => mh.command === h.command)));
            if (!exists) {
                config.hooks[event].push(matcher);
            }
        }
    }
    fs.writeFileSync(settingsFile, JSON.stringify(config, null, 2) + "\n");
}
export function ensureGitignore() {
    const gitignorePath = path.join(getProjectRoot(), ".gitignore");
    const entry = ".ctxflow/";
    if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, "utf-8");
        if (content.includes(entry))
            return;
        fs.appendFileSync(gitignorePath, `\n${entry}\n`);
    }
    else {
        fs.writeFileSync(gitignorePath, `${entry}\n`);
    }
}
//# sourceMappingURL=hooks.js.map