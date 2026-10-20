/**
 * Pre-Tool-Use Extension
 *
 * Runs before every tool executes. Responsibilities:
 *   1. Rewrite file paths when the agent is running inside a git worktree
 *      (ADW_WORKTREE_PATH / ADW_MAIN_REPO_PATH).
 *   2. Block access to `.env` files (allow `.env.sample` / `.env.example`).
 *   3. Block dangerous `rm` commands.
 *   4. Append every tool_call event to `.pi/logs/<session_id>/pre_tool_use.json`.
 *
 * This replaces an earlier Claude-Code-style stdin hook; pi dispatches these
 * in-process via `pi.on("tool_call", ...)`.
 */

import * as path from "path";
import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { appendJsonLog, ensureSessionLogDir } from "./utils/constants";

// Tools whose input carries a file path we may need to rewrite / inspect.
const FILE_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);

function isDangerousRmCommand(command: string): boolean {
	const normalized = command.toLowerCase().split(/\s+/).join(" ");

	const rmRecursiveForce = [
		/\brm\s+.*-[a-z]*r[a-z]*f/,
		/\brm\s+.*-[a-z]*f[a-z]*r/,
		/\brm\s+--recursive\s+--force/,
		/\brm\s+--force\s+--recursive/,
		/\brm\s+-r\s+.*-f/,
		/\brm\s+-f\s+.*-r/,
	];
	if (rmRecursiveForce.some((p) => p.test(normalized))) return true;

	// Any recursive rm targeting a broad / ambiguous path.
	if (/\brm\s+.*-[a-z]*r/.test(normalized)) {
		const dangerousPaths = [/\s\/\s/, /\s\/\*/, /\s~($|\s|\/)/, /\$HOME/, /\s\.\.(\s|$)/, /\s\*(\s|$)/, /\s\.(\s|$)/];
		if (dangerousPaths.some((p) => p.test(` ${normalized} `))) return true;
	}
	return false;
}

function isEnvFileAccess(toolName: string, input: Record<string, unknown>): boolean {
	const isEnvPath = (p: string) =>
		p.includes(".env") && !p.endsWith(".env.sample") && !p.endsWith(".env.example");

	if (toolName === "read" || toolName === "edit" || toolName === "write") {
		const filePath = (input.path as string | undefined) ?? (input.file_path as string | undefined) ?? "";
		if (filePath && isEnvPath(filePath)) return true;
	}

	if (toolName === "bash") {
		const command = (input.command as string | undefined) ?? "";
		// Match a `.env` filename at a path boundary; allow `.env.sample`/`.env.example`
		// and don't match word-internal cases like `process.env` or `.environment`.
		if (/(?<![\w.])\.env\b(?!\.(?:sample|example))/.test(command)) return true;
	}

	return false;
}

/**
 * When the agent runs inside a worktree, file paths from the model sometimes
 * reference the main repo root. Rewrite them to the worktree. Mutates `input`
 * in place (which is how pi expects `tool_call` handlers to patch arguments).
 */
function rewriteWorktreePath(toolName: string, input: Record<string, unknown>): boolean {
	const worktreePath = process.env.ADW_WORKTREE_PATH;
	const mainRepoPath = process.env.ADW_MAIN_REPO_PATH;
	if (!worktreePath || !mainRepoPath) return false;
	if (!FILE_TOOLS.has(toolName)) return false;

	let modified = false;
	for (const key of ["path", "file_path"] as const) {
		const value = input[key];
		if (typeof value === "string" && value.startsWith(mainRepoPath) && !value.startsWith(worktreePath)) {
			input[key] = worktreePath + value.slice(mainRepoPath.length);
			modified = true;
		}
	}
	return modified;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | undefined> => {
		const toolName = event.toolName;
		const input = event.input as Record<string, unknown>;

		// 1. Mutate input in place for worktree rewriting.
		rewriteWorktreePath(toolName, input);

		// 2. Safety checks.
		if (isEnvFileAccess(toolName, input)) {
			if (ctx.hasUI) {
				ctx.ui.notify("Blocked access to .env file (use .env.sample instead)", "warning");
			}
			return {
				block: true,
				reason: "Access to .env files containing sensitive data is prohibited. Use .env.sample for template files instead.",
			};
		}

		if (toolName === "bash") {
			const command = (input.command as string | undefined) ?? "";
			if (isDangerousRmCommand(command)) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Blocked dangerous rm command: ${command}`, "warning");
				}
				return { block: true, reason: "Dangerous rm command detected and prevented" };
			}
		}

		// 3. Log the (possibly-rewritten) tool call.
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			const logDir = ensureSessionLogDir(sessionId);
			appendJsonLog(path.join(logDir, "pre_tool_use.json"), {
				timestamp: new Date().toISOString(),
				session_id: sessionId,
				tool_call_id: event.toolCallId,
				parent_tool_call_id: event.parentToolCallId,
				tool_name: toolName,
				tool_input: input,
			});
		} catch {
			// Logging must never break tool execution.
		}

		return undefined;
	});
}
