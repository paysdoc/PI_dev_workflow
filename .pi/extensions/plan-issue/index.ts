/**
 * Plan check
 *
 * Checks every plan plan-issue writes against the plan format the templates
 * define (`planFormat.ts`, rules in `planCheck.ts`), so that every plan
 * states its write scope in the same structured way.
 *
 * Scope: active in a session whose prompt is the expanded `/skill:plan-issue`
 * block, like the report tools. It reads the labelled `unitTests` input from
 * that prompt (`unitTests: false`); without it, unit tests are on.
 *
 * After each `write` or `edit` under `specs/`, the file on disk is checked. A
 * failing plan stays on disk and the tool result becomes an error naming every
 * problem, so the model fixes the plan in the same session. The first failure
 * plus `MAX_RETRIES` failed fixes exhaust the budget: further writes are
 * blocked and the run ends. Each check is recorded as a `plan-check` custom
 * entry (not sent to the model), which is what the orchestrator reads and what
 * a resumed session rebuilds its state from.
 */

import * as fs from "node:fs";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { resolvePath, withinRoot, worktreeRelative } from "../shared/worktreePaths";
import { checkPlan } from "./planCheck";
import { isSkillPrompt, parseSkillPrompt, userText } from "../shared/skillSession";

const SKILL_NAME = "plan-issue";
export const ENTRY_TYPE = "plan-check";
export const MAX_RETRIES = 10;
const PLAN_ROOT = "specs/";
const REMINDER_TYPE = "plan-check-reminder";

export interface PlanCheckEntry {
	readonly path: string;
	readonly ok: boolean;
	readonly errors: readonly string[];
	/** Failed checks so far in this skill run, including this one. */
	readonly failures: number;
	/** True when this failure used up the budget. */
	readonly exhausted: boolean;
}

const UNIT_TESTS_INPUT = /^[ \t]*(?:[-*][ \t]+)?`?unitTests`?[ \t]*:[ \t]*`?([^`\s]*)`?[ \t]*$/m;

/** The labelled `unitTests` input after the `</skill>` block: true unless it is `false`; undefined when it is not a boolean. */
export function unitTestsInput(prompt: string): boolean | undefined {
	const end = prompt.indexOf("</skill>");
	const inputs = end < 0 ? prompt : prompt.slice(end + "</skill>".length);
	const value = UNIT_TESTS_INPUT.exec(inputs)?.[1]?.toLowerCase();
	if (value === undefined || value === "" || value === "true") return true;
	return value === "false" ? false : undefined;
}

interface RunState {
	unitTests: boolean | undefined;
	failures: number;
	exhausted: boolean;
	/** The last check failed and no later check passed. */
	pending: readonly string[] | undefined;
	reminders: number;
}

const freshRun = (prompt: string): RunState => ({
	unitTests: unitTestsInput(prompt),
	failures: 0,
	exhausted: false,
	pending: undefined,
	reminders: 0,
});

function planEntry(entry: SessionEntry): PlanCheckEntry | undefined {
	if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) return undefined;
	return entry.data as PlanCheckEntry;
}

/** Rebuilds the current run from the branch: the last plan-issue prompt, then the checks after it. */
export function stateFromBranch(entries: readonly SessionEntry[]): RunState | undefined {
	return entries.reduce<RunState | undefined>((run, entry) => {
		const text = userText(entry);
		const prompt = text === undefined ? undefined : parseSkillPrompt(text);
		if (text !== undefined && prompt !== undefined) return prompt.name === SKILL_NAME ? freshRun(text) : undefined;
		const check = run === undefined ? undefined : planEntry(entry);
		if (run === undefined || check === undefined) return run;
		return { ...run, failures: check.failures, exhausted: check.exhausted, pending: check.ok ? undefined : check.errors };
	}, undefined);
}

/** The worktree-relative path a write/edit targets when it lies under `specs/`. */
function planTarget(input: Record<string, unknown>, cwd: string): string | undefined {
	if (typeof input.path !== "string") return undefined;
	const absolute = resolvePath(input.path, cwd);
	const relative = absolute === undefined ? undefined : worktreeRelative(absolute, cwd);
	return relative !== undefined && withinRoot(relative, PLAN_ROOT) ? relative : undefined;
}

const isWrite = (toolName: string) => toolName === "write" || toolName === "edit";

function failureText(errors: readonly string[], failures: number, exhausted: boolean): string {
	const list = errors.map((error) => `- ${error}`).join("\n");
	if (exhausted) {
		return `The plan check failed ${failures} times. The plan stays on disk as it is, and no further writes are allowed. Stop now.\n${list}`;
	}
	const left = MAX_RETRIES + 1 - failures;
	return `The plan was written, but it fails the plan check. Fix every problem below in the same file (${left} attempt${left === 1 ? "" : "s"} left):\n${list}`;
}

export default function (pi: ExtensionAPI) {
	let run: RunState | undefined;

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		run = stateFromBranch(ctx.sessionManager.getBranch());
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType !== "user") return;
		if (isSkillPrompt(event.prompt, SKILL_NAME)) run = freshRun(event.prompt);
		else if (parseSkillPrompt(event.prompt) !== undefined) run = undefined;
	});

	pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext): ToolCallEventResult | undefined => {
		if (run === undefined || !isWrite(event.toolName)) return undefined;
		if (run.unitTests === undefined) {
			return { block: true, reason: 'plan check: the "unitTests" input must be true or false.' };
		}
		if (run.exhausted && planTarget(event.input as Record<string, unknown>, ctx.cwd) !== undefined) {
			return { block: true, reason: "plan check: the retry budget is used up, so no further writes are allowed. Stop now." };
		}
		return undefined;
	});

	pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext): ToolResultEventResult | undefined => {
		if (run === undefined || run.unitTests === undefined || event.isError || !isWrite(event.toolName)) return undefined;
		const target = planTarget(event.input, ctx.cwd);
		if (target === undefined) return undefined;
		let text: string;
		try {
			text = fs.readFileSync(resolvePath(target, ctx.cwd) ?? target, "utf8");
		} catch {
			return undefined;
		}
		const result = checkPlan(text, { cwd: ctx.cwd, unitTests: run.unitTests });
		if (result.ok) {
			run.pending = undefined;
			pi.appendEntry<PlanCheckEntry>(ENTRY_TYPE, { path: target, ok: true, errors: [], failures: run.failures, exhausted: false });
			return undefined;
		}
		run.failures += 1;
		run.exhausted = run.failures > MAX_RETRIES;
		run.pending = result.errors;
		const entry: PlanCheckEntry = {
			path: target,
			ok: false,
			errors: result.errors,
			failures: run.failures,
			exhausted: run.exhausted,
		};
		pi.appendEntry<PlanCheckEntry>(ENTRY_TYPE, entry);
		const content = [...event.content, { type: "text" as const, text: failureText(result.errors, run.failures, run.exhausted) }];
		return { content, isError: true };
	});

	// A model that replies after a failed check without fixing the plan gets one nudge per remaining attempt.
	pi.on("agent_before_settle", (event) => {
		if (run === undefined || run.exhausted || run.pending === undefined || event.outcome !== "completed") return undefined;
		if (run.reminders >= MAX_RETRIES + 1 - run.failures) return undefined;
		run.reminders += 1;
		return {
			entries: [
				...event.entries,
				{
					type: "custom_message" as const,
					customType: REMINDER_TYPE,
					content: `The plan still fails the plan check. Fix it now:\n${run.pending.map((error) => `- ${error}`).join("\n")}`,
					display: true,
				},
			],
			continue: true,
		};
	});
}
