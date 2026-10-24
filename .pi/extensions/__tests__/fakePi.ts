import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Handler = (event: unknown, ctx: unknown) => unknown;

export interface RegisteredTool {
	readonly name: string;
	readonly defaultActive?: boolean;
	execute(toolCallId: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown): Promise<unknown>;
}

const BUILT_IN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];

/** A stand-in for the parts of `ExtensionAPI` the extensions use. */
export function fakePi(initialTools: readonly string[] = ["read", "bash", "edit", "write"]) {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, RegisteredTool>();
	let active = [...initialTools];
	const api = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
			if (tool.defaultActive !== false) active = [...active, tool.name];
		},
		getActiveTools: () => [...active],
		setActiveTools(names: string[]) {
			active = names.filter((name) => tools.has(name) || BUILT_IN_TOOLS.includes(name));
		},
	};
	return {
		pi: api as unknown as ExtensionAPI,
		tools,
		activeTools: () => [...active],
		/** Runs every handler for the event and returns their results in order. */
		emit: (name: string, event: unknown, ctx: unknown = fakeContext()) =>
			(handlers.get(name) ?? []).map((handler) => handler(event, ctx)),
	};
}

export interface FakeEntry {
	readonly type: "message";
	readonly message: Record<string, unknown>;
}

export const userEntry = (content: string): FakeEntry => ({ type: "message", message: { role: "user", content } });

export const toolResultEntry = (toolName: string, isError = false): FakeEntry => ({
	type: "message",
	message: { role: "toolResult", toolName, isError },
});

export function fakeContext(options: { cwd?: string; branch?: readonly FakeEntry[] } = {}) {
	return {
		cwd: options.cwd ?? process.cwd(),
		hasUI: false,
		ui: { notify: () => undefined },
		sessionManager: { getBranch: () => options.branch ?? [] },
	};
}

export const skillPrompt = (name: string, location = `/skills/${name}/SKILL.md`) =>
	`<skill name="${name}" location="${location}">\nReferences are relative to ${path.dirname(location)}.\n\nbody\n</skill>\n\nissueNumber: 1`;

/** A throwaway worktree holding the given files (path → contents). */
export function makeWorktree(files: Readonly<Record<string, string>>): string {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guard-")));
	Object.entries(files).forEach(([file, content]) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	});
	return root;
}
