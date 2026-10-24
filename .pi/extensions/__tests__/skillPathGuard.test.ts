import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import extension from "../skill-path-guard";
import { evaluateToolCall, SKILL_POLICIES, type SkillPolicy } from "../utils/skillPolicies";
import { fakeContext, fakePi, makeWorktree, skillPrompt, userEntry } from "./fakePi";

let cwd: string;

beforeAll(() => {
	cwd = makeWorktree({
		"features/per-issue/feature-1.feature": "Feature: x",
		"features/regression/vocabulary.md": "# vocab",
		"specs/plan.md": "# plan",
		"specs/issue-1-adw-x-sdlc_planner-y.md": "# plan",
		"specs/prd/prd-guardrails.md": "# prd",
		"src/app.ts": "export {}",
		"src/app.test.ts": "test",
		"README.md": "# readme",
		".adw/scenarios.md": "# scenarios",
		"guidelines/coding_guidelines.md": "# guidelines",
		"guidelines/other.md": "# other",
		"cucumber.js": "export default {}",
		"skills/write-scenarios/SKILL.md": "skill",
		"skills/write-scenarios/layers.md": "layers",
	});
});

const policy = (name: string): SkillPolicy => {
	const found = SKILL_POLICIES[name];
	if (found === undefined) throw new Error(`no policy for ${name}`);
	return found;
};

const allowed = (skill: string, tool: string, input: Record<string, unknown>) =>
	evaluateToolCall(policy(skill), tool, input, { cwd }).ok;

describe("plan-issue policy", () => {
	it("blocks reads, searches and git reads of the scenario tree", () => {
		expect(allowed("plan-issue", "read", { path: "features/per-issue/feature-1.feature" })).toBe(false);
		expect(allowed("plan-issue", "grep", { pattern: "x" })).toBe(false);
		expect(allowed("plan-issue", "bash", { command: "git blame features/per-issue/feature-1.feature" })).toBe(false);
	});

	it("allows reading source and writing only under specs/", () => {
		expect(allowed("plan-issue", "read", { path: "src/app.ts" })).toBe(true);
		expect(allowed("plan-issue", "grep", { pattern: "x", path: "src" })).toBe(true);
		expect(allowed("plan-issue", "write", { path: "specs/issue-1-plan.md" })).toBe(true);
		expect(allowed("plan-issue", "edit", { path: "src/app.ts" })).toBe(false);
	});

	it("allows only read-only git in bash", () => {
		expect(allowed("plan-issue", "bash", { command: "npm test" })).toBe(false);
		expect(allowed("plan-issue", "bash", { command: "git log --oneline" })).toBe(true);
		expect(allowed("plan-issue", "powershell", { command: "ls" })).toBe(false);
	});
});

describe("write-scenarios policy", () => {
	it("allows the scenario tree and docs, but not source, unit tests or plans", () => {
		expect(allowed("write-scenarios", "read", { path: "features/regression/vocabulary.md" })).toBe(true);
		expect(allowed("write-scenarios", "read", { path: "README.md" })).toBe(true);
		expect(allowed("write-scenarios", "read", { path: ".adw/scenarios.md" })).toBe(true);
		expect(allowed("write-scenarios", "read", { path: "src/app.ts" })).toBe(false);
		expect(allowed("write-scenarios", "read", { path: "src/app.test.ts" })).toBe(false);
		expect(allowed("write-scenarios", "read", { path: "specs/plan.md" })).toBe(false);
	});

	it("allows the PRDs under specs/prd/ but not the plans", () => {
		expect(allowed("write-scenarios", "read", { path: "specs/prd/prd-guardrails.md" })).toBe(true);
		expect(allowed("write-scenarios", "read", { path: "specs/issue-1-adw-x-sdlc_planner-y.md" })).toBe(false);
		expect(allowed("write-scenarios", "ls", { path: "specs" })).toBe(true);
	});

	it("allows the guidelines fallback and the runner configuration, and nothing else beside them", () => {
		expect(allowed("write-scenarios", "read", { path: "guidelines/coding_guidelines.md" })).toBe(true);
		expect(allowed("write-scenarios", "read", { path: "cucumber.js" })).toBe(true);
		expect(allowed("write-scenarios", "read", { path: "guidelines/other.md" })).toBe(false);
		expect(allowed("write-scenarios", "write", { path: "cucumber.js" })).toBe(false);
	});

	it("allows writes only under features/, including the vocabulary", () => {
		expect(allowed("write-scenarios", "write", { path: "features/regression/vocabulary.md" })).toBe(true);
		expect(allowed("write-scenarios", "write", { path: "src/app.ts" })).toBe(false);
	});

	it("allows git only on the scenario tree", () => {
		expect(allowed("write-scenarios", "bash", { command: "git diff -- features/" })).toBe(true);
		expect(allowed("write-scenarios", "bash", { command: "git diff" })).toBe(false);
	});
});

describe("implement-tdd policy", () => {
	it("blocks writes to the scenario tree and leaves everything else alone", () => {
		expect(allowed("implement-tdd", "write", { path: "features/steps/a.steps.ts" })).toBe(false);
		expect(allowed("implement-tdd", "edit", { path: "src/app.ts" })).toBe(true);
		expect(allowed("implement-tdd", "read", { path: "features/per-issue/feature-1.feature" })).toBe(true);
		expect(allowed("implement-tdd", "bash", { command: "npm test" })).toBe(true);
	});
});

describe("guard extension", () => {
	const location = () => path.join(cwd, "skills/write-scenarios/SKILL.md");

	function start(prompt: string) {
		const fake = fakePi();
		extension(fake.pi);
		fake.emit("before_agent_start", { messageType: "user", prompt });
		return fake;
	}

	const call = (fake: ReturnType<typeof fakePi>, toolName: string, input: Record<string, unknown>) =>
		fake.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName, input }, fakeContext({ cwd }))[0];

	it("does nothing outside a guarded skill", () => {
		const fake = start("hello");
		expect(call(fake, "read", { path: "specs/plan.md" })).toBeUndefined();
		expect(fake.activeTools()).not.toContain("grep");
	});

	it("blocks per the policy and activates the search tools", () => {
		const fake = start(skillPrompt("write-scenarios", location()));
		expect(call(fake, "read", { path: "specs/plan.md" })).toMatchObject({ block: true });
		expect(fake.activeTools()).toEqual(expect.arrayContaining(["grep", "find", "ls"]));
	});

	it("lets the skill read its own directory", () => {
		const fake = start(skillPrompt("write-scenarios", location()));
		expect(call(fake, "read", { path: path.join(cwd, "skills/write-scenarios/layers.md") })).toBeUndefined();
	});

	it("keeps the policy for plain follow-up prompts, and drops it for another skill", () => {
		const fake = start(skillPrompt("write-scenarios", location()));
		fake.emit("before_agent_start", { messageType: "user", prompt: "Your last message was not valid JSON." });
		expect(call(fake, "read", { path: "src/app.ts" })).toMatchObject({ block: true });
		fake.emit("before_agent_start", { messageType: "user", prompt: skillPrompt("grill-me") });
		expect(call(fake, "read", { path: "src/app.ts" })).toBeUndefined();
	});

	it("rewrites an allowed git command in place", () => {
		const fake = start(skillPrompt("plan-issue"));
		const input = { command: "git diff" };
		expect(call(fake, "bash", input)).toBeUndefined();
		expect(input.command).toBe("git diff -- ':(exclude)features/'");
	});

	const result = (fake: ReturnType<typeof fakePi>, toolName: string, input: Record<string, unknown>, text: string) =>
		fake.emit(
			"tool_result",
			{ type: "tool_result", toolCallId: "1", toolName, input, content: [{ type: "text", text }], isError: false },
			fakeContext({ cwd }),
		)[0];

	it("hides the plans' names from a find over the whole worktree", () => {
		const fake = start(skillPrompt("write-scenarios", location()));
		const listing = "specs/issue-1-adw-x-sdlc_planner-y.md\nspecs/prd/prd-guardrails.md";
		expect(result(fake, "find", { pattern: "specs/**" }, listing)).toEqual({
			content: [{ type: "text", text: "specs/prd/prd-guardrails.md\n\n[1 entries hidden: specs/issue-* is off limits]" }],
		});
	});

	it("hides the scenario tree from plan-issue's listings, and leaves other results alone", () => {
		const fake = start(skillPrompt("plan-issue"));
		expect(result(fake, "ls", {}, "README.md\nfeatures/\nsrc/")).toMatchObject({
			content: [{ text: expect.stringMatching(/^README\.md\nsrc\/\n\n\[1 entries hidden/) }],
		});
		expect(result(fake, "read", { path: "src/app.ts" }, "features/x")).toBeUndefined();
	});

	it("restores the policy from the branch on session_start", () => {
		const fake = fakePi();
		extension(fake.pi);
		const branch = [userEntry(skillPrompt("plan-issue")), userEntry("follow-up")];
		fake.emit("session_start", {}, fakeContext({ cwd, branch }));
		expect(call(fake, "read", { path: "features/per-issue/feature-1.feature" })).toMatchObject({ block: true });
	});
});
