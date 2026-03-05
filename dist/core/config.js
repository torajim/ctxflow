import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";
const DEFAULT_CONFIG = {
    syncIntervalMs: 5_000,
    inactiveThresholdMs: 60_000,
    maxFilesTouched: 50,
    maxLogSize: 1_048_576,
    pushMaxRetries: 3,
    pushRetryBaseMs: 500,
};
let cachedConfig = null;
export function loadConfig() {
    if (cachedConfig)
        return cachedConfig;
    const configPath = path.join(getProjectRoot(), "ctxflow.config.json");
    try {
        if (fs.existsSync(configPath)) {
            const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            const merged = { ...DEFAULT_CONFIG, ...raw };
            cachedConfig = merged;
            return merged;
        }
    }
    catch {
        // Invalid config file — use defaults
    }
    const defaults = { ...DEFAULT_CONFIG };
    cachedConfig = defaults;
    return defaults;
}
export function resetConfigCache() {
    cachedConfig = null;
}
//# sourceMappingURL=config.js.map