import fs from "node:fs";
import path from "node:path";
import { ctxflowDir } from "./paths.js";

// NOTE: logDebug intentionally does NOT import loadConfig() to avoid circular
// dependencies (config.ts may call logDebug indirectly). Uses a sensible default.
const DEFAULT_MAX_LOG_SIZE = 1_048_576; // 1 MB

export function logDebug(message: string): void {
  try {
    const logPath = path.join(ctxflowDir(), "debug.log");
    const timestamp = new Date().toISOString();

    try {
      const stat = fs.statSync(logPath);
      if (stat.size > DEFAULT_MAX_LOG_SIZE) {
        const oldPath = logPath + ".old";
        try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
        fs.renameSync(logPath, oldPath);
      }
    } catch {
      // File doesn't exist yet
    }

    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch {
    // Logging should never break the app
  }
}
