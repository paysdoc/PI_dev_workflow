import * as fs from "node:fs";
import * as path from "node:path";
import { checkPath, containsRoot, type PathContext, type PathRules, resolvePath, worktreeRelative } from "./pathPolicy";

export interface GitRules {
	/** Subcommands allowed as the second word, e.g. ["log", "show"]. Global git options are never allowed. */
	readonly subcommands: readonly string[];
	/** Rules for every path the command names, before or after `--`. */
	readonly paths: PathRules;
	/** The command must name at least one path, so it cannot reach the whole tree. */
	readonly requirePaths: boolean;
	/**
	 * Subcommands that get an `:(exclude)<root>` pathspec for each deny root,
	 * so a command over the whole tree still skips the denied roots.
	 */
	readonly excludeDeniedFor: readonly string[];
}

export type GitVerdict = { readonly ok: true; readonly command: string } | { readonly ok: false; readonly reason: string };

const blocked = (reason: string): GitVerdict => ({ ok: false, reason });

// Quotes and expansions are rejected outright: the guard checks words, so the
// shell must not be able to turn them into anything else.
const SHELL_METACHARACTERS = /[;&|`$<>(){}[\]*?!\\'"#\n\r]/;

// Each of these makes git read or write a file outside the pathspec.
const BANNED_OPTIONS = ["--output", "--ext-diff", "--textconv", "--no-index", "--contents", "-L"];

interface Words {
	readonly subcommand: string;
	/** Options and revisions, in their original order. */
	readonly leading: readonly string[];
	/** Paths named before `--` and the pathspecs after it. */
	readonly paths: readonly string[];
	/** Paths read through `<rev>:<path>`, which stay in `leading`. */
	readonly revisionPaths: readonly string[];
}

const isOption = (word: string) => word.startsWith("-");

function existsInWorktree(word: string, context: PathContext): boolean {
	return fs.existsSync(path.resolve(context.cwd, word));
}

/** The path part of `<rev>:<path>` or `:<path>`, or undefined for any other word. */
function revisionPath(word: string): string | undefined {
	const colon = word.indexOf(":");
	if (colon < 0) return undefined;
	const rest = word.slice(colon + 1);
	return rest === "" ? "." : rest;
}

/** Splits `git <subcommand> ...` the way git does: a word before `--` is a path only if it exists. */
function parseWords(words: readonly string[], context: PathContext): Words {
	const [, subcommand = "", ...args] = words;
	const separator = args.indexOf("--");
	const before = separator < 0 ? args : args.slice(0, separator);
	const after = separator < 0 ? [] : args.slice(separator + 1);
	const isPathWord = (word: string) =>
		!isOption(word) && revisionPath(word) === undefined && existsInWorktree(word, context);
	return {
		subcommand,
		leading: before.filter((word) => !isPathWord(word)),
		paths: [...before.filter(isPathWord), ...after],
		revisionPaths: before.filter((word) => !isOption(word)).flatMap((word) => revisionPath(word) ?? []),
	};
}

function checkPathWord(word: string, rules: GitRules, excludes: boolean, context: PathContext): string | undefined {
	const verdict = checkPath(word, rules.paths, context, "Naming");
	if (!verdict.ok) return verdict.reason;
	if (excludes) return undefined;
	const absolute = resolvePath(word, context.cwd);
	const relative = absolute === undefined ? undefined : worktreeRelative(absolute, context.cwd);
	const enclosed = rules.paths.deny?.find((root) => relative !== undefined && containsRoot(relative, root));
	return enclosed === undefined ? undefined : `"${word}" contains ${enclosed}, which is off limits.`;
}

function firstProblem(parsed: Words, rules: GitRules, context: PathContext): string | undefined {
	const banned = parsed.leading.find((word) => BANNED_OPTIONS.some((option) => word.startsWith(option)));
	if (banned !== undefined) return `The option "${banned}" is not allowed.`;
	if (rules.requirePaths && parsed.paths.length === 0) {
		return `Name the paths to inspect after "--", within: ${(rules.paths.allow ?? []).join(", ")}.`;
	}
	const excludes = rules.excludeDeniedFor.includes(parsed.subcommand);
	// A `<rev>:<path>` word reads that one path, so no exclusion pathspec can cover it.
	const revisionProblem = parsed.revisionPaths
		.map((word) => checkPathWord(word, rules, false, context))
		.find((problem) => problem !== undefined);
	if (revisionProblem !== undefined) return revisionProblem;
	return parsed.paths.map((word) => checkPathWord(word, rules, excludes, context)).find((problem) => problem !== undefined);
}

function rebuild(parsed: Words, rules: GitRules): string {
	const excludes = rules.excludeDeniedFor.includes(parsed.subcommand)
		? (rules.paths.deny ?? []).map((root) => `':(exclude)${root}'`)
		: [];
	const pathspecs = [...parsed.paths, ...excludes];
	const tail = pathspecs.length === 0 ? [] : ["--", ...pathspecs];
	return ["git", parsed.subcommand, ...parsed.leading, ...tail].join(" ");
}

/**
 * Checks a bash command against a read-only git allowlist. On success returns
 * the command to run: its paths moved after `--`, plus any exclusion pathspecs.
 */
export function checkGitCommand(command: string, rules: GitRules, context: PathContext): GitVerdict {
	const trimmed = command.trim();
	if (SHELL_METACHARACTERS.test(trimmed)) return blocked("Shell metacharacters, quotes and expansions are not allowed.");
	const words = trimmed.split(/\s+/);
	if (words.some((word) => word.startsWith("~"))) return blocked("Home-directory expansion is not allowed.");
	const allowed = rules.subcommands.map((name) => `git ${name}`).join(", ");
	if (words[0] !== "git" || !rules.subcommands.includes(words[1] ?? "")) {
		return blocked(`Only these commands are allowed: ${allowed}.`);
	}
	const parsed = parseWords(words, context);
	const problem = firstProblem(parsed, rules, context);
	if (problem !== undefined) return blocked(problem);
	return { ok: true, command: rebuild(parsed, rules) };
}
