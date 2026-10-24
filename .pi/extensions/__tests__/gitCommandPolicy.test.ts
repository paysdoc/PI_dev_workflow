import { beforeAll, describe, expect, it } from "vitest";
import { checkGitCommand, type GitRules } from "../utils/gitCommandPolicy";
import { makeWorktree } from "./fakePi";

let cwd: string;

beforeAll(() => {
	cwd = makeWorktree({ "features/a.feature": "Feature: a", "src/app.ts": "export {}" });
});

const planRules: GitRules = {
	subcommands: ["log", "show", "diff", "blame"],
	paths: { deny: ["features/"] },
	requirePaths: false,
	excludeDeniedFor: ["log", "show", "diff"],
};

const scenarioRules: GitRules = {
	subcommands: ["status", "diff", "log", "show"],
	paths: { allow: ["features/"] },
	requirePaths: true,
	excludeDeniedFor: [],
};

describe("checkGitCommand with deny rules", () => {
	it("appends an exclusion pathspec to a command over the whole tree", () => {
		expect(checkGitCommand("git diff", planRules, { cwd })).toEqual({
			ok: true,
			command: "git diff -- ':(exclude)features/'",
		});
	});

	it("moves an existing path after -- and keeps the revisions in front", () => {
		expect(checkGitCommand("git log --oneline HEAD~3 src/app.ts", planRules, { cwd })).toEqual({
			ok: true,
			command: "git log --oneline HEAD~3 -- src/app.ts ':(exclude)features/'",
		});
	});

	it("blocks a path inside the denied root", () => {
		expect(checkGitCommand("git log -- features/a.feature", planRules, { cwd }).ok).toBe(false);
		expect(checkGitCommand("git blame features/a.feature", planRules, { cwd }).ok).toBe(false);
	});

	it("blocks <rev>:<path> reads of the denied root", () => {
		expect(checkGitCommand("git show HEAD:features/a.feature", planRules, { cwd }).ok).toBe(false);
	});

	it("does not add exclusions to blame, which takes one file", () => {
		expect(checkGitCommand("git blame src/app.ts", planRules, { cwd })).toEqual({
			ok: true,
			command: "git blame -- src/app.ts",
		});
	});

	it("blocks subcommands outside the allowlist and global options", () => {
		expect(checkGitCommand("git checkout main", planRules, { cwd }).ok).toBe(false);
		expect(checkGitCommand("git -c core.pager=x log", planRules, { cwd }).ok).toBe(false);
		expect(checkGitCommand("cat src/app.ts", planRules, { cwd }).ok).toBe(false);
	});

	it("blocks options that read or write files outside the pathspec", () => {
		["--output=x", "--ext-diff", "--textconv", "--no-index", "-L1,2:src/app.ts"].forEach((option) => {
			expect(checkGitCommand(`git diff ${option}`, planRules, { cwd }).ok).toBe(false);
		});
		expect(checkGitCommand("git blame --contents x src/app.ts", planRules, { cwd }).ok).toBe(false);
	});

	it("blocks shell metacharacters, quotes and home expansion", () => {
		["git log; cat x", "git log | head", "git log $(x)", "git log 'a'", "git log > out", "git log ~/x"].forEach(
			(command) => expect(checkGitCommand(command, planRules, { cwd }).ok).toBe(false),
		);
	});
});

describe("checkGitCommand with allow rules", () => {
	it("allows a command limited to the allowed root", () => {
		expect(checkGitCommand("git status -- features/", scenarioRules, { cwd })).toEqual({
			ok: true,
			command: "git status -- features/",
		});
		expect(checkGitCommand("git diff features", scenarioRules, { cwd }).ok).toBe(true);
	});

	it("requires at least one path", () => {
		expect(checkGitCommand("git status", scenarioRules, { cwd }).ok).toBe(false);
		expect(checkGitCommand("git show HEAD", scenarioRules, { cwd }).ok).toBe(false);
	});

	it("blocks paths outside the allowed root, before or after --", () => {
		expect(checkGitCommand("git diff -- src/app.ts", scenarioRules, { cwd }).ok).toBe(false);
		expect(checkGitCommand("git diff src/app.ts -- features/", scenarioRules, { cwd }).ok).toBe(false);
		expect(checkGitCommand("git show HEAD:src/app.ts -- features/", scenarioRules, { cwd }).ok).toBe(false);
	});
});
