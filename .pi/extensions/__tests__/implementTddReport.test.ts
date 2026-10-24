import { describe, expect, it } from "vitest";
import extension, { checkReport, type ImplementationReport, TOOL_NAME } from "../implement-tdd-report";
import { fakeContext, fakePi, skillPrompt, toolResultEntry, userEntry } from "./fakePi";

const slice = (overrides: Partial<ImplementationReport["slices"][number]> = {}) => ({
	planTask: "Add parser",
	finding: null,
	scenario: null,
	unitTest: "red-green" as const,
	reason: null,
	...overrides,
});

describe("checkReport", () => {
	it("accepts a well-formed report", () => {
		expect(checkReport({ tdd: true, slices: [slice()] })).toEqual([]);
	});

	it("requires exactly one of planTask and finding", () => {
		expect(checkReport({ tdd: true, slices: [slice({ finding: "lint" })] })).toHaveLength(1);
		expect(checkReport({ tdd: true, slices: [slice({ planTask: null })] })).toHaveLength(1);
	});

	it("requires a reason for a blocked slice", () => {
		expect(checkReport({ tdd: true, slices: [slice({ unitTest: "blocked" })] })).toHaveLength(1);
	});

	it("ties skipped unit tests to tdd", () => {
		expect(checkReport({ tdd: false, slices: [slice()] })).toHaveLength(1);
		expect(checkReport({ tdd: true, slices: [slice({ unitTest: "skipped" })] })).toHaveLength(1);
	});

	it("requires a described failure", () => {
		expect(checkReport({ tdd: true, slices: [], failed: { scenario: " ", planTask: null, conflict: "" } })).toHaveLength(2);
	});
});

function setup() {
	const fake = fakePi();
	extension(fake.pi);
	return fake;
}

const startSkill = (fake: ReturnType<typeof fakePi>, prompt = skillPrompt("implement-tdd")) =>
	fake.emit("before_agent_start", { messageType: "user", prompt });

const settle = (fake: ReturnType<typeof fakePi>) => fake.emit("agent_before_settle", { outcome: "completed" })[0];

describe("report tool lifecycle", () => {
	it("registers the tool inactive", () => {
		const fake = setup();
		expect(fake.tools.has(TOOL_NAME)).toBe(true);
		expect(fake.activeTools()).not.toContain(TOOL_NAME);
	});

	it("activates the tool only for the skill's prompt", () => {
		const fake = setup();
		startSkill(fake, skillPrompt("plan-issue"));
		expect(fake.activeTools()).not.toContain(TOOL_NAME);
		startSkill(fake);
		expect(fake.activeTools()).toContain(TOOL_NAME);
	});

	it("reminds at most twice when no report arrives", () => {
		const fake = setup();
		startSkill(fake);
		expect(settle(fake)).toMatchObject({ continue: true });
		expect(settle(fake)).toMatchObject({ continue: true });
		expect(settle(fake)).toBeUndefined();
	});

	it("does not remind outside the skill or after an aborted run", () => {
		const fake = setup();
		expect(settle(fake)).toBeUndefined();
		startSkill(fake);
		expect(fake.emit("agent_before_settle", { outcome: "aborted" })[0]).toBeUndefined();
	});

	it("rejects an invalid report and stops reminding after an accepted one", async () => {
		const fake = setup();
		startSkill(fake);
		const tool = fake.tools.get(TOOL_NAME);
		const bad = { tdd: true, slices: [slice({ planTask: null })] };
		await expect(tool?.execute("1", bad, undefined, undefined, fakeContext())).rejects.toThrow(/Report rejected/);
		const result = await tool?.execute("2", { tdd: true, slices: [slice()] }, undefined, undefined, fakeContext());
		expect(result).toMatchObject({ terminate: true, details: { tdd: true } });
		expect(settle(fake)).toBeUndefined();
	});

	it("rebuilds its state from the branch on session_start", () => {
		const fake = setup();
		const reported = [userEntry(skillPrompt("implement-tdd")), toolResultEntry(TOOL_NAME)];
		fake.emit("session_start", {}, fakeContext({ branch: reported }));
		expect(fake.activeTools()).toContain(TOOL_NAME);
		expect(settle(fake)).toBeUndefined();

		const failedReport = [userEntry(skillPrompt("implement-tdd")), toolResultEntry(TOOL_NAME, true)];
		fake.emit("session_start", {}, fakeContext({ branch: failedReport }));
		expect(settle(fake)).toMatchObject({ continue: true });
	});
});
