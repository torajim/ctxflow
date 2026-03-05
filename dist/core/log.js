import fs from "node:fs";
import path from "node:path";
import { ctxflowDir } from "./paths.js";
const MAX_LOG_SIZE = 1_048_576; // 1 MB
export function logDebug(message) {
    try {
        const logPath = path.join(ctxflowDir(), "debug.log");
        const timestamp = new Date().toISOString();
        // Rotate if log exceeds max size
        try {
            const stat = fs.statSync(logPath);
            if (stat.size > MAX_LOG_SIZE) {
                const oldPath = logPath + ".old";
                try {
                    fs.unlinkSync(oldPath);
                }
                catch { /* ignore */ }
                fs.renameSync(logPath, oldPath);
            }
        }
        catch {
            // File doesn't exist yet, that's fine
        }
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    }
    catch {
        // Logging should never break the app
    }
}
//# sourceMappingURL=log.js.map