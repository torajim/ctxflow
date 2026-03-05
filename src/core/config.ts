import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

export interface CtxflowConfig {
  syncIntervalMs: number;
  inactiveThresholdMs: number;
  maxFilesTouched: number;
  maxLogSize: number;
  pushMaxRetries: number;
  pushRetryBaseMs: number;
}

const DEFAULT_CONFIG: CtxflowConfig = {
  syncIntervalMs: 5_000,
  inactiveThresholdMs: 60_000,
  maxFilesTouched: 50,
  maxLogSize: 1_048_576,
  pushMaxRetries: 3,
  pushRetryBaseMs: 500,
};

let cachedConfig: CtxflowConfig | null = null;
let cachedConfigMtime: number = 0;

function validateConfig(raw: Record<string, unknown>): Partial<CtxflowConfig> {
  const result: Partial<CtxflowConfig> = {};
  const numericKeys: (keyof CtxflowConfig)[] = [
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

export function loadConfig(): CtxflowConfig {
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
    const merged: CtxflowConfig = { ...DEFAULT_CONFIG, ...validated };
    cachedConfig = merged;
    cachedConfigMtime = mtime;
    return merged;
  } catch {
    // File doesn't exist or is invalid — reset to defaults
    cachedConfig = { ...DEFAULT_CONFIG };
    cachedConfigMtime = 0;
    return cachedConfig;
  }
}

export function resetConfigCache(): void {
  cachedConfig = null;
  cachedConfigMtime = 0;
}
