import * as fs from "fs";
import * as path from "path";

/**
 * Root directory for per-session log files written by the pre/post tool-use
 * extensions. Lives under `.pi/logs/` next to the project's `.pi/extensions`.
 */
export const LOG_ROOT = path.resolve(
	process.env.PI_PROJECT_LOG_DIR ?? path.join(process.cwd(), ".pi", "logs"),
);

/**
 * Returns (and creates if missing) the log directory for the given session id.
 * Falls back to `"unknown"` when no id is available.
 */
export function ensureSessionLogDir(sessionId: string | undefined | null): string {
	const safeId = (sessionId && String(sessionId).trim()) || "unknown";
	// Keep the id filesystem-safe (session ids are usually uuids, but be defensive).
	const sanitized = safeId.replace(/[^A-Za-z0-9._-]/g, "_");
	const dir = path.join(LOG_ROOT, sanitized);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Append a JSON entry to a log file as a JSON array. Creates the file if
 * missing and tolerates a corrupted existing file by starting fresh.
 */
export function appendJsonLog(logPath: string, entry: unknown): void {
	let logData: unknown[] = [];
	if (fs.existsSync(logPath)) {
		try {
			const content = fs.readFileSync(logPath, "utf-8");
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed)) logData = parsed;
		} catch {
			logData = [];
		}
	}
	logData.push(entry);
	fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
}
