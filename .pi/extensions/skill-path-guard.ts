/**
 * Skill path guard
 *
 * Enforces each skill's read, write and bash limits deterministically, so the
 * skills' prompts do not have to. The policies live in `utils/skillPolicies.ts`.
 *
 * Scope: a policy applies from the moment a session's prompt is the expanded
 * `/skill:<name>` block of a skill in the table, and stays in force for later
 * prompts in that session (findings, repair messages) until another skill's
 * prompt replaces it. On resume, the last skill prompt on the branch decides.
 *
 * The skill's own directory stays readable, so it can load its supporting files.
 * Listings (`ls`, `find`) of a parent of a denied root are allowed, and their
 * results lose the entries inside the denied root.
 */

import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { evaluateToolCall, filterToolResult, SEARCH_TOOLS, SKILL_POLICIES, type SkillPolicy } from "./utils/skillPolicies";
import { lastSkillPrompt, parseSkillPrompt, type SkillPrompt } from "./utils/skillSession";

interface ActiveSkill {
	readonly name: string;
	readonly policy: SkillPolicy;
	readonly skillDir?: string;
}

export function activeSkillFor(prompt: SkillPrompt | undefined): ActiveSkill | undefined {
	if (prompt === undefined) return undefined;
	const policy = SKILL_POLICIES[prompt.name];
	if (policy === undefined) return undefined;
	const skillDir = prompt.location === undefined ? undefined : path.dirname(prompt.location);
	return skillDir === undefined ? { name: prompt.name, policy } : { name: prompt.name, policy, skillDir };
}

function filterResultContent(policy: SkillPolicy, event: ToolResultEvent, cwd: string): ToolResultEventResult | undefined {
	const filterText = (text: string) => filterToolResult(policy, event.toolName, event.input, text, { cwd });
	const changed = event.content.some((part) => part.type === "text" && filterText(part.text) !== part.text);
	if (!changed) return undefined;
	return { content: event.content.map((part) => (part.type === "text" ? { ...part, text: filterText(part.text) } : part)) };
}

export default function (pi: ExtensionAPI) {
	let active: ActiveSkill | undefined;

	const enter = (skill: ActiveSkill | undefined) => {
		active = skill;
		if (!skill?.policy.searchTools) return;
		const tools = pi.getActiveTools();
		const missing = SEARCH_TOOLS.filter((tool) => !tools.includes(tool));
		if (missing.length > 0) pi.setActiveTools([...tools, ...missing]);
	};

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		enter(activeSkillFor(lastSkillPrompt(ctx.sessionManager.getBranch())));
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType !== "user") return;
		const prompt = parseSkillPrompt(event.prompt);
		// A plain prompt inside a skill session keeps the skill's policy.
		if (prompt !== undefined) enter(activeSkillFor(prompt));
	});

	pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext): ToolCallEventResult | undefined => {
		if (active === undefined) return undefined;
		const input = event.input as Record<string, unknown>;
		const readableDirs = active.skillDir === undefined ? [] : [active.skillDir];
		const verdict = evaluateToolCall(active.policy, event.toolName, input, { cwd: ctx.cwd, readableDirs });
		if (!verdict.ok) {
			if (ctx.hasUI) ctx.ui.notify(`${active.name}: blocked ${event.toolName}: ${verdict.reason}`, "warning");
			return { block: true, reason: `${active.name} guard: ${verdict.reason}` };
		}
		if (verdict.command !== undefined && verdict.command !== input.command) input.command = verdict.command;
		return undefined;
	});

	pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext): ToolResultEventResult | undefined => {
		if (active === undefined || event.isError) return undefined;
		return filterResultContent(active.policy, event, ctx.cwd);
	});
}
