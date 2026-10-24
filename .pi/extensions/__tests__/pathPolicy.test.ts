import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	checkList,
	checkRead,
	checkSearch,
	checkWrite,
	containsRoot,
	hideDeniedEntries,
	withinRoot,
} from "../utils/pathPolicy";
import { makeWorktree } from "./fakePi";

let cwd: string;
let outside: string;

beforeAll(() => {
	cwd = makeWorktree({
		"features/per-issue/feature-1.feature": "Feature: x",
		"specs/plan.md": "# plan",
		"specs/issue-7-adw-x-sdlc_planner-y.md": "# plan",
		"specs/prd/prd-a.md": "# prd",
		"src/app.ts": "export {}",
		"README.md": "# readme",
	});
	outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "outside-")));
	fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
	fs.symlinkSync(outside, path.join(cwd, "features", "escape"));
});

describe("withinRoot / containsRoot", () => {
	it("matches a directory root and everything below it", () => {
		expect(withinRoot("features", "features/")).toBe(true);
		expect(withinRoot("features/a/b.feature", "features/")).toBe(true);
		expect(withinRoot("featuresX/a", "features/")).toBe(false);
	});

	it("matches a file root exactly", () => {
		expect(withinRoot("README.md", "README.md")).toBe(true);
		expect(withinRoot("README.md.bak", "README.md")).toBe(false);
	});

	it("matches a prefix root by its prefix", () => {
		expect(withinRoot("specs/issue-7-adw-x.md", "specs/issue-*")).toBe(true);
		expect(withinRoot("specs/prd/prd-a.md", "specs/issue-*")).toBe(false);
		expect(containsRoot("specs", "specs/issue-*")).toBe(true);
	});

	it("treats the worktree root and parent directories as containing a root", () => {
		expect(containsRoot("", "features/")).toBe(true);
		expect(containsRoot("features", "features/regression/")).toBe(true);
		expect(containsRoot("features", "features/")).toBe(false);
		expect(containsRoot("src", "features/")).toBe(false);
	});
});

describe("checkRead", () => {
	const allow = { allow: ["features/", "README.md"], deny: ["specs/"] };

	it("allows a file within an allowed root", () => {
		expect(checkRead("features/per-issue/feature-1.feature", allow, { cwd }).ok).toBe(true);
		expect(checkRead("@README.md", allow, { cwd }).ok).toBe(true);
	});

	it("blocks a file outside the allowed roots", () => {
		expect(checkRead("src/app.ts", allow, { cwd }).ok).toBe(false);
	});

	it("blocks a denied root even when given as an absolute path", () => {
		expect(checkRead(path.join(cwd, "specs/plan.md"), { deny: ["specs/"] }, { cwd }).ok).toBe(false);
	});

	it("blocks a path outside the worktree", () => {
		expect(checkRead("../x.txt", { deny: [] }, { cwd }).ok).toBe(false);
	});

	it("blocks a symlink that escapes the worktree", () => {
		const verdict = checkRead("features/escape/secret.txt", allow, { cwd });
		expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("outside the worktree") });
	});

	it("allows the skill's own directory even outside the worktree", () => {
		expect(checkRead(path.join(outside, "secret.txt"), allow, { cwd, readableDirs: [outside] }).ok).toBe(true);
	});
});

describe("checkSearch", () => {
	it("blocks a search whose root contains a denied root", () => {
		expect(checkSearch(".", { deny: ["features/"] }, { cwd }).ok).toBe(false);
	});

	it("allows a search of a sibling directory", () => {
		expect(checkSearch("src", { deny: ["features/"] }, { cwd }).ok).toBe(true);
	});

	it("requires the search root to lie within an allowed root", () => {
		expect(checkSearch(".", { allow: ["features/"] }, { cwd }).ok).toBe(false);
		expect(checkSearch("features", { allow: ["features/"] }, { cwd }).ok).toBe(true);
	});
});

describe("checkList", () => {
	it("allows listing a parent of a denied root, since it returns only names", () => {
		expect(checkList(".", { deny: ["features/"] }, { cwd }).ok).toBe(true);
	});

	it("blocks listing inside a denied root", () => {
		expect(checkList("features/per-issue", { deny: ["features/"] }, { cwd }).ok).toBe(false);
	});

	it("ignores the allow roots, but keeps the worktree boundary", () => {
		expect(checkList("src", { allow: ["features/"] }, { cwd }).ok).toBe(true);
		expect(checkList("..", { allow: ["features/"] }, { cwd }).ok).toBe(false);
	});
});

describe("checkWrite", () => {
	it("allows a new file within an allowed root", () => {
		expect(checkWrite("features/steps/new/area.steps.ts", { allow: ["features/"] }, { cwd }).ok).toBe(true);
	});

	it("blocks a write outside the allowed roots", () => {
		expect(checkWrite("src/app.ts", { allow: ["features/"] }, { cwd }).ok).toBe(false);
	});

	it("blocks a write into a denied root", () => {
		expect(checkWrite("features/steps/x.ts", { deny: ["features/"] }, { cwd }).ok).toBe(false);
	});
});

describe("hideDeniedEntries", () => {
	const rules = { deny: ["specs/issue-*"] };

	it("removes denied entries from an ls result and says how many it hid", () => {
		const output = hideDeniedEntries("issue-7-adw-x-sdlc_planner-y.md\nplan.md\nprd/", "specs", rules, { cwd });
		expect(output).toBe("plan.md\nprd/\n\n[1 entries hidden: specs/issue-* is off limits]");
	});

	it("removes denied entries from a find result from the root and keeps pi's notices last", () => {
		const output = hideDeniedEntries(
			"specs/issue-7-adw-x-sdlc_planner-y.md\nspecs/prd/prd-a.md\n\n[100 results limit reached]",
			".",
			rules,
			{ cwd },
		);
		expect(output).toBe(
			"specs/prd/prd-a.md\n\n[1 entries hidden: specs/issue-* is off limits]\n\n[100 results limit reached]",
		);
	});

	it("leaves a result with nothing denied unchanged", () => {
		expect(hideDeniedEntries("prd-a.md", "specs/prd", rules, { cwd })).toBe("prd-a.md");
		expect(hideDeniedEntries("issue-7.md", "specs", {}, { cwd })).toBe("issue-7.md");
	});
});
