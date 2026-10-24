import { checkGitCommand, type GitRules } from "./gitCommandPolicy";
import {
	blocked,
	checkList,
	checkRead,
	checkSearch,
	checkWrite,
	hideDeniedEntries,
	OK,
	type PathContext,
	type PathRules,
	type Verdict,
} from "./pathPolicy";

export interface SkillPolicy {
	/** Rules for `read`, `grep`, `find` and `ls`. Undefined leaves reads unchecked. */
	readonly read?: PathRules;
	/** Rules for `write` and `edit`. Undefined leaves writes unchecked. */
	readonly write?: PathRules;
	/** A read-only git allowlist for `bash`. Undefined leaves bash unchecked. */
	readonly bash?: GitRules;
	/** Activate pi's built-in `grep`, `find` and `ls`, whose path arguments the guard can check. */
	readonly searchTools: boolean;
}

export const SEARCH_TOOLS = ["grep", "find", "ls"] as const;

const SCENARIO_TREE = "features/";

// write-scenarios reads the runner's configuration to see which files it loads.
const RUNNER_CONFIGS = ["cucumber.js", "cucumber.mjs", "cucumber.cjs", "cucumber.json", "cucumber.yaml", "cucumber.yml"];

export const SKILL_POLICIES: Readonly<Record<string, SkillPolicy>> = {
	"plan-issue": {
		read: { deny: [SCENARIO_TREE] },
		write: { allow: ["specs/"] },
		bash: {
			subcommands: ["log", "show", "diff", "blame"],
			paths: { deny: [SCENARIO_TREE] },
			requirePaths: false,
			excludeDeniedFor: ["log", "show", "diff"],
		},
		searchTools: true,
	},
	"write-scenarios": {
		read: {
			allow: [
				SCENARIO_TREE,
				// PRDs are requirements an issue may name as its parent; the plans are not.
				"specs/prd/",
				"README.md",
				"app_docs/",
				".adw/",
				"UBIQUITOUS_LANGUAGE.md",
				// ADW's fallback location for the coding guidelines in older repos.
				"guidelines/coding_guidelines.md",
				...RUNNER_CONFIGS,
			],
			// Not redundant with `allow`: listing (`ls`, `find`) ignores `allow` and obeys
			// only `deny`, so this also hides the plans' file names from the scenario writer.
			deny: ["specs/issue-*"],
		},
		write: { allow: [SCENARIO_TREE] },
		bash: {
			subcommands: ["status", "diff", "log", "show"],
			paths: { allow: [SCENARIO_TREE] },
			requirePaths: true,
			excludeDeniedFor: [],
		},
		searchTools: true,
	},
	"implement-tdd": {
		write: { deny: [SCENARIO_TREE] },
		searchTools: false,
	},
};

export type ToolVerdict = { readonly ok: true; readonly command?: string } | { readonly ok: false; readonly reason: string };

const pathArgument = (input: Record<string, unknown>, fallback?: string): string | undefined => {
	const value = input.path ?? fallback;
	return typeof value === "string" ? value : undefined;
};

function checkPathTool(
	rules: PathRules | undefined,
	check: (input: string, rules: PathRules, context: PathContext) => Verdict,
	target: string | undefined,
	context: PathContext,
): Verdict {
	if (rules === undefined) return OK;
	if (target === undefined) return blocked("The path argument is missing or not a string.");
	return check(target, rules, context);
}

function checkBash(rules: GitRules | undefined, input: Record<string, unknown>, context: PathContext): ToolVerdict {
	if (rules === undefined) return OK;
	if (typeof input.command !== "string") return blocked("The command argument is missing or not a string.");
	return checkGitCommand(input.command, rules, context);
}

/**
 * Decides one tool call under a skill's policy. Tools the policy does not
 * mention, such as report tools, pass. A returned `command` replaces the bash
 * command, because the guard adds exclusion pathspecs.
 */
export function evaluateToolCall(
	policy: SkillPolicy,
	toolName: string,
	input: Record<string, unknown>,
	context: PathContext,
): ToolVerdict {
	switch (toolName) {
		case "read":
			return checkPathTool(policy.read, checkRead, pathArgument(input), context);
		case "grep":
			return checkPathTool(policy.read, checkSearch, pathArgument(input, "."), context);
		case "find":
		case "ls":
			return checkPathTool(policy.read, checkList, pathArgument(input, "."), context);
		case "write":
		case "edit":
			return checkPathTool(policy.write, checkWrite, pathArgument(input), context);
		case "bash":
			return checkBash(policy.bash, input, context);
		case "powershell":
			return policy.bash === undefined ? OK : blocked("Use bash; powershell is not allowed in this skill.");
		default:
			return OK;
	}
}

/**
 * Hides entries inside the policy's deny roots from an `ls` or `find` result.
 * Returns the text unchanged for every other tool.
 */
export function filterToolResult(
	policy: SkillPolicy,
	toolName: string,
	input: Record<string, unknown>,
	text: string,
	context: PathContext,
): string {
	if (policy.read === undefined || (toolName !== "ls" && toolName !== "find")) return text;
	const listed = pathArgument(input, ".");
	return listed === undefined ? text : hideDeniedEntries(text, listed, policy.read, context);
}
