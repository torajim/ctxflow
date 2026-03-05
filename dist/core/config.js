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
let cachedConfigMtime = 0;
function validateConfig(raw) {
    const result = {};
    const numericKeys = [
        "syncIntervalMs",
        "inactiveThresholdMs",
        "maxFilesTouched",
        "maxLogSize",
        "pushMaxRetries",
        "pushRetryBaseMs",
    ];
    for (const key of numericKeys) {
        if (key in raw) {
            const val = raw[key];
            if (typeof val === "number" && val > 0 && Number.isFinite(val)) {
                result[key] = val;
            }
        }
    }
    return result;
}
export function loadConfig() {
    const configPath = path.join(getProjectRoot(), "ctxflow.config.json");
    try {
        const stat = fs.statSync(configPath);
        const mtime = stat.mtimeMs;
        // Return cache if file hasn't changed
        if (cachedConfig && mtime === cachedConfigMtime) {
            return cachedConfig;
        }
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const validated = validateConfig(raw);
        const merged = { ...DEFAULT_CONFIG, ...validated };
        cachedConfig = merged;
        cachedConfigMtime = mtime;
        return merged;
    }
    catch {
        // File doesn't exist or is invalid — reset to defaults
        cachedConfig = { ...DEFAULT_CONFIG };
        cachedConfigMtime = 0;
        return cachedConfig;
    }
}
export function resetConfigCache() {
    cachedConfig = null;
    cachedConfigMtime = 0;
}
//# sourceMappingURL=config.js.map