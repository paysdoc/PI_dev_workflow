import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import extension, { ENTRY_TYPE, MAX_RETRIES, stateFromBranch, unitTestsInput } from "..";
import { checkPlan } from "../planCheck";
import { parsePlan } from "../planFormat";
import { customEntry, fakeContext, fakePi, makeWorktree, skillPrompt, userEntry } from "../../shared/__tests__/fakePi";

let cwd: string;

beforeAll(() => {
	cwd = makeWorktree({
		"src/app.ts": "export {}",
		"src/app.test.ts": "test",
		"src/util.ts": "export {}",
		"README.md": "# readme",
		"features/a.feature": "Feature: a",
		"specs/.keep": "",
	});
	fs.mkdirSync(path.join(cwd, "src/dir"));
});

interface PlanParts {
	relevant?: string;
	change?: string;
	created?: string;
	tasks?: string;
	dependencies?: string;
}

const plan = (parts: PlanParts = {}) => `# Feature: x

## Metadata
issueNumber: \`1\`

## Relevant Files
${parts.relevant ?? "- `README.md`: overview\n- `src/app.ts`: the module"}

### Files to Change
${parts.change ?? "- `src/app.ts`: add parse()\n- `src/app.test.ts`: tests for parse()"}

### New Files
${parts.created ?? "- `src/parser.ts`: the parser"}

## Step by Step Tasks
${
	parts.tasks ??
	`### 1. Add the parser
- Write parse() in \`src/parser.ts\`.
Files: \`src/parser.ts\`, \`src/app.ts\`
Tests: \`src/app.test.ts\`

### 2. Run the Validation Commands
- Run them.
Files: none
Tests: none: validation only`
}

## Acceptance Criteria
- parses

## Validation Commands
- \`npm test\`

## Notes
### Dependencies
${parts.dependencies ?? "- none"}
`;

const check = (text: string, unitTests = true) => checkPlan(text, { cwd, unitTests });
const errorsOf = (text: string, unitTests = true) => {
	const result = check(text, unitTests);
	return result.ok ? [] : result.errors;
};

describe("parsePlan", () => {
	it("reads the write scope, the tasks and the dependencies", () => {
		const result = parsePlan(plan({ dependencies: "- `zod`: `npm install zod`" }));
		expect(result).toMatchObject({
			ok: true,
			plan: {
				relevantFiles: ["README.md", "src/app.ts"],
				filesToChange: ["src/app.ts", "src/app.test.ts"],
				newFiles: ["src/parser.ts"],
				tasks: [
					{ title: "1. Add the parser", files: ["src/parser.ts", "src/app.ts"], tests: { paths: ["src/app.test.ts"] } },
					{ title: "2. Run the Validation Commands", files: [], tests: { none: "validation only" } },
				],
				dependencies: [{ name: "zod", install: "npm install zod" }],
			},
		});
	});

	it("accepts '- none' for empty file sections", () => {
		const result = parsePlan(plan({ created: "- none", tasks: "### 1. Edit\nFiles: `src/app.ts`, `src/app.test.ts`\nTests: none: n/a" }));
		expect(result.ok && result.plan.newFiles).toEqual([]);
	});

	it("ignores headings inside code fences", () => {
		const fenced = plan().replace("## Validation Commands", "```md\n## Relevant Files\n### New Files\n```\n\n## Validation Commands");
		expect(parsePlan(fenced).ok).toBe(true);
	});

	it("names every missing section", () => {
		const result = parsePlan("# Feature: x\n\n## Relevant Files\n- `a.ts`: a\n");
		expect(result.ok).toBe(false);
		const errors = result.ok ? [] : result.errors.join("\n");
		expect(errors).toContain("### Files to Change");
		expect(errors).toContain("### New Files");
		expect(errors).toContain("## Step by Step Tasks");
		expect(errors).toContain("## Notes");
		const noDependencies = parsePlan(plan().replace("### Dependencies\n- none", ""));
		expect(noDependencies.ok ? [] : noDependencies.errors).toEqual(['Missing "### Dependencies" under "## Notes".']);
	});

	it("requires each task to end with Files: and Tests:", () => {
		const errors = errorsOf(plan({ tasks: "### 1. Add\n- do it\nTests: none: x" }));
		expect(errors.join("\n")).toMatch(/must end with a "Files:" line followed by a "Tests:" line/);
	});

	it("requires a reason for Tests: none", () => {
		const errors = errorsOf(plan({ tasks: "### 1. Add\nFiles: `src/app.ts`, `src/app.test.ts`, `src/parser.ts`\nTests: none" }));
		expect(errors.join("\n")).toContain("needs a reason");
	});

	it("rejects bullets without a backticked path and loose text in Files:", () => {
		expect(errorsOf(plan({ change: "- src/app.ts: no backticks" })).join("\n")).toContain("must start with a backticked path");
		const loose = plan({ tasks: "### 1. Add\nFiles: `src/app.ts` and `src/parser.ts`\nTests: `src/app.test.ts`" });
		expect(errorsOf(loose).join("\n")).toContain("backticked paths separated by commas");
	});
});

describe("checkPlan", () => {
	it("accepts a well-formed plan", () => {
		expect(check(plan())).toMatchObject({ ok: true });
	});

	it("requires the task lines and the write lists to match exactly", () => {
		const missing = errorsOf(plan({ created: "- none" }));
		expect(missing.join("\n")).toContain("`src/parser.ts` is named in a task");
		const extra = errorsOf(plan({ change: "- `src/app.ts`: a\n- `src/app.test.ts`: t\n- `src/util.ts`: unused" }));
		expect(extra.join("\n")).toContain("`src/util.ts` is listed");
	});

	it("checks that files to change exist and new files do not", () => {
		const errors = errorsOf(
			plan({
				change: "- `src/app.ts`: a\n- `src/app.test.ts`: t\n- `src/gone.ts`: g",
				created: "- `src/parser.ts`: p\n- `src/util.ts`: exists",
				tasks: "### 1. All\nFiles: `src/app.ts`, `src/gone.ts`, `src/parser.ts`, `src/util.ts`\nTests: `src/app.test.ts`",
			}),
		).join("\n");
		expect(errors).toContain("`src/gone.ts` does not exist");
		expect(errors).toContain("`src/util.ts` already exists");
	});

	it("rejects globs, directories, absolute and non-canonical paths", () => {
		const bad = ["src/*.ts", "src/dir/", "/etc/passwd", "./src/app.ts", "src/../src/app.ts"];
		const errors = errorsOf(
			plan({
				change: bad.map((file) => `- \`${file}\`: x`).join("\n"),
				created: "- none",
				tasks: `### 1. All\nFiles: ${bad.map((file) => `\`${file}\``).join(", ")}\nTests: none: n/a`,
			}),
		);
		expect(errors.filter((error) => error.startsWith("### Files to Change"))).toHaveLength(bad.length);
	});

	it("rejects writes under features/ and specs/", () => {
		const errors = errorsOf(
			plan({
				change: "- `features/a.feature`: no",
				created: "- `specs/new-plan.md`: no",
				tasks: "### 1. Bad\nFiles: `features/a.feature`, `specs/new-plan.md`\nTests: none: n/a",
			}),
		).join("\n");
		expect(errors).toContain("under features/");
		expect(errors).toContain("under specs/");
	});

	it("rejects a file listed twice", () => {
		const errors = errorsOf(plan({ created: "- `src/parser.ts`: p\n- `src/parser.ts`: again" }));
		expect(errors.join("\n")).toContain("listed more than once");
	});

	it("requires Tests: none on every task when unit tests are off", () => {
		const errors = errorsOf(plan(), false);
		expect(errors).toEqual([expect.stringContaining('Task "1. Add the parser": unit tests are off')]);
	});
});

describe("unitTestsInput", () => {
	it("reads the labelled input after the skill block", () => {
		expect(unitTestsInput(`${skillPrompt("plan-issue")}\nunitTests: false`)).toBe(false);
		expect(unitTestsInput(`${skillPrompt("plan-issue")}\n- \`unitTests\`: \`true\``)).toBe(true);
		expect(unitTestsInput(skillPrompt("plan-issue"))).toBe(true);
		expect(unitTestsInput(`${skillPrompt("plan-issue")}\nunitTests: maybe`)).toBeUndefined();
	});
});

describe("plan check extension", () => {
	const planPath = "specs/issue-1-adw-x-sdlc_planner-y.md";

	function start(prompt = skillPrompt("plan-issue")) {
		const fake = fakePi();
		extension(fake.pi);
		fake.emit("before_agent_start", { messageType: "user", prompt });
		return fake;
	}

	const writePlan = (fake: ReturnType<typeof fakePi>, text: string, file = planPath) => {
		fs.writeFileSync(path.join(cwd, file), text);
		const event = {
			type: "tool_result",
			toolCallId: "1",
			toolName: "write",
			input: { path: file, content: text },
			content: [{ type: "text", text: "Successfully wrote" }],
			isError: false,
		};
		return fake.emit("tool_result", event, fakeContext({ cwd }))[0] as { isError?: boolean; content?: { text: string }[] } | undefined;
	};

	const call = (fake: ReturnType<typeof fakePi>, file = planPath) =>
		fake.emit("tool_call", { type: "tool_call", toolCallId: "2", toolName: "write", input: { path: file } }, fakeContext({ cwd }))[0];

	const settle = (fake: ReturnType<typeof fakePi>) =>
		fake.emit("agent_before_settle", { outcome: "completed", entries: [], continue: false })[0];

	it("does nothing outside plan-issue", () => {
		const fake = start(skillPrompt("implement-tdd"));
		expect(writePlan(fake, "not a plan")).toBeUndefined();
		expect(fake.entries).toEqual([]);
	});

	it("passes a good plan and records the check", () => {
		const fake = start();
		expect(writePlan(fake, plan())).toBeUndefined();
		expect(fake.entries).toEqual([{ customType: ENTRY_TYPE, data: expect.objectContaining({ ok: true, path: planPath }) }]);
		expect(settle(fake)).toBeUndefined();
	});

	it("ignores writes outside specs/", () => {
		const fake = start();
		const event = { type: "tool_result", toolName: "write", input: { path: "src/app.ts" }, content: [], isError: false };
		expect(fake.emit("tool_result", event, fakeContext({ cwd }))[0]).toBeUndefined();
	});

	it("allows 10 retries", () => {
		expect(MAX_RETRIES).toBe(10);
	});

	it("turns a failing write into an error, nudges once per attempt left, then blocks", () => {
		const fake = start();
		const first = writePlan(fake, "# broken");
		expect(first?.isError).toBe(true);
		expect(first?.content?.at(-1)?.text).toContain(`${MAX_RETRIES} attempts left`);
		for (let nudge = 0; nudge < MAX_RETRIES; nudge++) expect(settle(fake)).toMatchObject({ continue: true });
		expect(settle(fake)).toBeUndefined();

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) writePlan(fake, "# still broken");
		expect(fake.entries.at(-1)?.data).toMatchObject({ ok: false, failures: MAX_RETRIES + 1, exhausted: true });
		expect(call(fake)).toMatchObject({ block: true });
		expect(call(fake, "src/app.ts")).toBeUndefined();
		expect(settle(fake)).toBeUndefined();
	});

	it("clears the pending failure once the plan passes", () => {
		const fake = start();
		writePlan(fake, "# broken");
		writePlan(fake, plan());
		expect(settle(fake)).toBeUndefined();
	});

	it("applies unitTests: false from the prompt", () => {
		const fake = start(`${skillPrompt("plan-issue")}\nunitTests: false`);
		expect(writePlan(fake, plan())?.isError).toBe(true);
	});

	it("blocks every write when the unitTests input is not a boolean", () => {
		const fake = start(`${skillPrompt("plan-issue")}\nunitTests: maybe`);
		expect(call(fake, "src/app.ts")).toMatchObject({ block: true });
	});

	it("rebuilds the budget from the branch", () => {
		const failed = { path: planPath, ok: false, errors: ["x"], failures: MAX_RETRIES + 1, exhausted: true };
		const branch = [userEntry(skillPrompt("plan-issue")), customEntry(ENTRY_TYPE, failed)];
		expect(stateFromBranch(branch as never)).toMatchObject({ exhausted: true, failures: MAX_RETRIES + 1 });
		const fake = fakePi();
		extension(fake.pi);
		fake.emit("session_start", {}, fakeContext({ cwd, branch }));
		expect(call(fake)).toMatchObject({ block: true });

		const later = [...branch, userEntry(skillPrompt("implement-tdd"))];
		expect(stateFromBranch(later as never)).toBeUndefined();
	});
});
