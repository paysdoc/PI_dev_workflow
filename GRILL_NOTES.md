# Grill Notes

Decisions from the grills, and the work they left. Read this before starting a new grill.

- **To do** is the checklist: tick an item when it is done, and leave it in the list. Each item names the decision section that has its context.
- **Decisions** records what was settled and what was built. It doesn't hold open work.

Question numbers: `Q<n>` from the skill grills, `S<n>` from the plan-scope grill.

# To do

## Decide
- [ ] **plan-issue: retry on verifier failure.** Proposed: one retry with the verifier's reason fed back, then fail the phase. (plan-issue)
- [ ] **implement-tdd: retry budget.** How many times the validator may re-invoke implement-tdd with findings, and how many gap rounds (S14) may go back to plan-issue. (implement-tdd › Findings and report)
- [ ] **write-scenarios: redirect budget.** How many times alignment may re-invoke write-scenarios. (write-scenarios › Alignment)
- [ ] **write-scenarios: a finding it can't apply.** What it reports when a finding would break one of its Rules. `failed` means "wrote nothing", which doesn't fit a redirect. Needs a report field (e.g. `rejectedFindings`) or an explicit rule. (write-scenarios › Alignment)
- [ ] **Validation step: pre-existing failures.** Whether failures in files the agent never touched are reported separately. (implement-tdd › Validation step)
- [ ] **AGENTS.md in target repos.** Move `CLAUDE.md` content into `AGENTS.md` and make `CLAUDE.md` a pointer, or not. Generated from `.adw/` (with a staleness hash) or a hand-written index of `.adw/` files. (plan-issue › AGENTS.md)
- [ ] **`newTerms` owner.** Who maintains `UBIQUITOUS_LANGUAGE.md` from write-scenarios' `newTerms`. If nobody, drop the field. (write-scenarios › Report)
- [ ] **Chores and write-scenarios.** Whether the orchestrator runs write-scenarios for chores. (write-scenarios › Orchestrator)
- [ ] **Credentials for unattended runs.** Where the orchestrator launches pi: an emptied environment, or an OS boundary (container or separate user). (Facts › Credentials)
- [ ] **skill-path-guard: scenario directory.** Keep the literal `features/`, or read `## Scenario Directory`. (write-scenarios › skill-path-guard)
- [ ] **implement-tdd reads (S9).** Enforce "read only the plan's files, the `.adw/` inputs and the scenarios", or drop the rule from SKILL.md. (Plan scope)
- [ ] **After the replays: plan format.** Simplify the `Files:`/`Tests:` format if it costs plan-issue too many retries. (Plan scope › Plan format)
- [ ] **After the replays: `Tests: none` (S19).** Act if planners mark tests `none` without good reason. (Plan scope › implement-tdd)

## Build: orchestrator
- [ ] Compute `planPath`, and write `# <Type>: <name>` plus `## Metadata` itself (check the header with `^# (Bug|Chore|Feature): .+$`). The agent stops copying `issueJson`. (plan-issue)
- [ ] Then narrow plan-issue's `write`/`edit` in skill-path-guard from `specs/` to the exact `planPath`. (plan-issue)
- [ ] Then remove `correctPlanFileNaming` from the old ADW. (plan-issue)
- [ ] Resolve `unitTests` from `.github/adw.yml` in code and pass it to plan-issue and implement-tdd (S18). (plan-issue)
- [ ] Pass the runner mode to write-scenarios as an input, instead of the skill reading `## Application Type`. (write-scenarios › Orchestrator)
- [ ] Don't invoke write-scenarios for issues labelled `regression-promotion` or `adw:none` (ADW `scenarioAuthoringSkipReason`). (write-scenarios › Orchestrator)
- [ ] Filter comments (human comments only, the actionable comment) before passing them to the skills. (write-scenarios › Orchestrator)
- [ ] Commit once both plan-issue and write-scenarios have finished. (write-scenarios › Orchestrator)
- [ ] Derive `regressionTouched` from `report_scenarios` and apply `hitl` (Q52). (write-scenarios › Orchestrator)
- [ ] Build the alignment phase: when a misalignment comes from the scenarios, re-invoke write-scenarios with `alignmentFindings: [{scenario?, instruction}]`. (write-scenarios › Alignment)
- [ ] Pass `report_scenarios.scenarios` to implement-tdd as its `scenarios` input. (write-scenarios › Orchestrator)
- [ ] Read both reports from the tool result's `details`/`structuredContent`, not from the last message. (implement-tdd › Findings and report)
- [ ] On implement-tdd's `failed` (misalignment), loop back to the alignment phase. (implement-tdd › Alignment)
- [ ] When a slice has `scopeGaps`, send the gaps to plan-issue to amend the plan, then resume implement-tdd. Never auto-approve gaps (S14). (Plan scope › implement-tdd)

## Build: WorkflowNode verifiers
- [ ] **plan-issue verifier.** Runs the unit tests, `## Validation Commands`, and the plan structure checks the plan check doesn't cover (header, required sections per type, `## Relevant Files` paths exist). (plan-issue)
- [ ] **implement-tdd validation step.** Runs the full unit suite, `## Type Check` and `## Run Linter` after implement-tdd, and feeds failures back as `findings`. (implement-tdd › Validation step)
- [ ] **write-scenarios verifier.** Type check over `features/` and `cucumber-js --dry-run` (undefined and ambiguous steps). In web mode, the guarded `cd features && (test -d node_modules || npm ci) && npx bddgen` instead. (write-scenarios)

## Build: drivers skill
- [ ] A separate skill, run by a different agent than the implementer, once the implementation exists. It:
  - implements every `driverMethods` entry (the stubs throw `NotImplemented("<Area>Driver.<method>")`) and swaps the stubs for real drivers in `features/support/drivers/index.ts`
  - fills the `TBD (driver)` `Pattern` and `Assertion target` columns of newly registered phrases
  - owns hermetic test mode (test-mode switch, stubbed externals, seeded data, deterministic clock), mobile and device runs, screenshots and the `ADW_*` environment
  - (implement-tdd › Drivers and scenario runs)
- [ ] The verifier runs the scenarios; scenario-level RED and GREEN happen there. (implement-tdd › Drivers and scenario runs)

## Validate
- [x] plan-issue: A/B on past issues, old vs new plan, judged by a human. Done in runs 1–3. (write-scenarios › skill-path-guard)
- [ ] plan-issue: rerun with the new plan format and plan check (`Files:`/`Tests:`, `### Files to Change`). Count plan-check retries. (Plan scope › Plan format)
- [ ] implement-tdd: replay 2 past ADW issues with `@adw-N` scenarios in throwaway worktrees. Compare the report and a human review of the diff with the original runs; check it stayed in scope. Scenario results are not compared. (implement-tdd)
- [ ] write-scenarios: replay 2 past ADW issues with `@adw-N` scenarios in throwaway worktrees. Run the verifier, and have a human compare coverage and domain language with the original scenarios. (write-scenarios)

## Clean up
- [x] Commit the uncommitted work: the extensions reorganisation, the plan check and template changes, the implement-tdd skill edits and these notes.
- [ ] `.pi/extensions/multi-model-hooks.ts` imports `@mariozechner/pi-coding-agent`, the old package name, which `tsc` can't resolve. Check whether pi loads it (startup diagnostics) and fix or remove it. It also injects model-specific instructions into the planner. (plan-issue › Parked)
- [ ] `.pi/extensions/btw.ts` fails the strict type check.
- [ ] `.pi/presets.json` is inert (nothing reads it), and its `plan` preset contradicts the planner needing `write`. Remove or fix it.
- [ ] Remove `commands/scenario_writer.md` and `commands/generate_step_definitions.md` once the orchestrator uses write-scenarios.
- [ ] Trim the other agents (`implement`, `review`, `test`, `scenario_writer`, …) that read `.adw/*.md` themselves, once AGENTS.md is decided.
- [ ] Consider folding `commands/pr_review.md` and `commands/patch.md`, which are also plan-shaped, into plan-issue.
- [ ] Optional (WET): copy `shared/worktreePaths.ts` into plan-issue and skill-path-guard, its only two users.

# Decisions

## plan-issue skill (replaces commands/bug.md, chore.md, feature.md)

- **Moves out of the skill once the orchestrator and WorkflowNode exist:** the metadata and plan path go to the orchestrator; running tests, `## Validation Commands` and structure checks go to a verifier. Planning test-*writing* tasks stays in the skill.
- **`unitTests` is an input (S18).** A boolean resolved by code, not parsed from `.github/adw.yml` by the model. Both plan-issue and implement-tdd take it.
- **Prose rules → `tool_call` hooks, done in `.pi/extensions/skill-path-guard/`.** The prose rules are gone from the skill:
  - `write`/`edit` only under `specs/`.
  - bash allowlist `git (log|show|diff|blame)` only. It rejects shell metacharacters, quotes, global git options (so `-c` too), `--output`, `--ext-diff`, `--textconv`, `--no-index`, `--contents` and `-L`.
  - no reads under **all of `features/`**, widened from `features/per-issue/` because write-scenarios now writes steps, DSL and drivers there too. `git log/show/diff` get `:(exclude)features/` appended, and `grep` over a parent of `features/` is blocked.

### AGENTS.md
- The target repo's `AGENTS.md`/`CLAUDE.md` reaches skill runs (pi isn't launched with `-nc`). Keep conventions that matter in `.adw/coding_guidelines.md` either way.
- Use a managed block between `<!-- adw:begin -->` and `<!-- adw:end -->`, keeping human content outside it. Agreed as the right direction.
- Pi loads only ONE context file per directory, first match of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` (verified: `pi-coding-agent/dist/core/resource-loader.js:115-133`). Adding AGENTS.md silently hides an existing CLAUDE.md.
- AGENTS.md is loaded by every agent in the cwd (implementer, reviewer, humans), so it holds only universal facts, never planner rules. It must live in the target repo, because the planner's cwd is the target worktree.

## implement-tdd skill (rewrite of ADW's `.claude/skills/implement-tdd`)

The skill does unit-level TDD only. It treats the scenario directory as read-only and never runs scenarios.

### Upstream owns the scenario layers
- **Author: the write-scenarios skill.** It writes the Gherkin, the step definitions, the DSL verbs, the `Driver` interface and the stub drivers. It must never be the implementing agent.
- **Layering** (Farley's four layers). Steps call domain-level DSL verbs, and the DSL calls a typed `Driver` interface. Stub drivers throw `NotImplemented("<method>")`.
- **Assertions** and expected values live only in steps and the DSL. Drivers only act and return observations: no `expect` calls, no constants that come from the scenario. This is the guard against bending the test to fit the implementation.
- **The `Driver` interface describes the test's needs, not the app's design.** The app never implements it. The unit tests shape the app's design.
- **Config (done).** `.adw/scenarios.md` has `## DSL Directory` and `## Driver Directory`, defaulting to `features/support/dsl/` and `features/support/drivers/`.
- **Moved upstream from `generate_step_definitions` / `stepDefPhase`:** framework idiom, Step Def Directory, the duplicate-pattern ban, vocabulary registry validation, and the runner mode. The runner mode comes from `## Application Type` in `.adw/project.md` (`cli` → descriptor, `web` → adw_playwright, `mobile:kotlincm` → descriptor + devices; see ADW `adws/core/applicationType.ts`). `stepDefPhase` is dropped.

### Drivers and scenario runs
- Drivers are filled in by a separate skill, once the implementation exists, run by a *different* agent than the implementer. Hermetic test mode (formerly §8 of implement-tdd) moves there.
- ADW found (verified: `scenarioTestPhase.ts:241`) that only the scenario test phase receives `ADW_APPLICATION_URL` and the device env variables. The build phase never could run browser or device scenarios.

### Alignment
- Plan/scenario alignment happens upstream, before the build.
- implement-tdd fails hard on misalignment and reports `failed: {scenario, planTask, conflict}`.

### Validation step
- Finish checks are not part of the skill: the full unit suite, `## Type Check` and `## Run Linter` run in a WorkflowNode validation step after implement-tdd.

### Commits and resume
- implement-tdd commits once per slice (`<plan task>[ (<scenario>)]`, or `blocked: <plan task>`, in `commitFormat`) and never pushes. Resume reads `git log` to find finished slices.

### Findings and report
- **Findings.** implement-tdd takes an optional labelled `findings` list (`source`, `file?`, `detail`) from the validator. Each finding becomes an extra slice after the plan slices, and findings never override the skill's Rules. Free-form prompt input was rejected because it invites scope creep.
- **Report via tool, not raw JSON.** `.pi/extensions/implement-tdd/` registers `report_implementation`, whose TypeBox schema is the single source of truth for the report (exported as `ImplementationReport`).
  - Pi validates the arguments against the schema and returns errors to the model as a failed tool call, so the model retries in the same session. `execute()` rejects what the schema cannot express: exactly one of `planTask`/`finding`, `reason` on `blocked`, `skipped` when `tdd: false` (also allowed for a `Tests: none` task or a non-behaviour finding).
  - `constrainedSampling: { type: "json_schema", strict: "prefer" }` turns on provider-side strict tools where available; keep the schema strict-compatible (no `oneOf`/`allOf`, no object unions, no `minLength`).
  - Registered with `defaultActive: false`. It becomes active only when a run's prompt is the expanded `/skill:implement-tdd` block (`<skill name="implement-tdd"`), and is restored on resume from the session branch. No other session sees it.
  - The accepted report is in the tool result's `details` / `structuredContent`; the call returns `terminate: true`.
  - If a run ends without an accepted report, `agent_before_settle` sends a reminder and continues, at most twice. This replaced the planned `sendUserMessage()` JSON repair.

## Plan scope (implement-tdd sticks to the plan)

Goal: implement-tdd sticks to the plan and doesn't refactor outside its scope. The grill settled on code enforcement (a scope guard plus target-repo isolation). Both were built and then removed as overengineered: **the prompt keeps implement-tdd in scope, and an occasional step outside it is accepted.**

### Plan format and plan check (plan-issue)
- **Read list and write lists are separate (S2).** `## Relevant Files` lists files to read. `### Files to Change` and `### New Files` list files to write, and both are required (S36).
- **Structured task lines (S16).** Each task in `## Step by Step Tasks` ends with `Files:` (paths it creates or changes) and `Tests:` (unit test paths, or `none: <reason>`). Together the `Files:` and `Tests:` paths must equal `### Files to Change` plus `### New Files`, with nothing missing and nothing extra.
- **Path rules (S24).** Exact paths relative to the worktree, no globs. A file to change must exist; a new file must not. Nothing under `features/` or `specs/`.
- **Plan check (S15, S20).** `.pi/extensions/plan-issue/` hooks plan-issue's `write`/`edit` of the plan file. On failure the file stays on disk and the errors come back in the tool result, so plan-issue fixes it in the same session. After 10 failed retries (`MAX_RETRIES`) the run ends with an error the orchestrator can see.
- **`unitTests: false` (S18).** Every task must then say `Tests: none`. Kept boolean; make it three-state only when a real config needs one.
- **Dependencies (S8, S25).** When `## Notes` records a dependency, `package.json` and the lockfiles already at the repo root are in scope. No new lockfiles.
- **Tests are listed, not inferred (S5, S28).** The plan lists test files, snapshots and golden files; nothing pairs them automatically.
- **Why structured fields (evidence).** A path-scraping check over 147 old ADW plans in `~/projects/paysdoc/*/specs/` (`/tmp/scopecheck.py`, run with `python3 -I`) flagged 94 as naming paths in tasks that `## Relevant Files` lacks. Most flags were noise: import specifiers (`../modules/linter.js`), bare file names (`cli.ts`), build outputs (`dist/cli.js`), globs and fixtures. Scraping task text would reject good plans.
- The structured format was mainly there so the scope guard could read the plan. It still gives implement-tdd and reviewers an exact file list.

### implement-tdd (prompt only)
- **Scope section in SKILL.md.** Change only the files in `### Files to Change` and `### New Files`, plus a finding's `file` while handling findings. A new file may hold only code moved out of an in-scope file or code the slice writes (S33). Never copy code out of an out-of-scope file.
- **REFACTOR is limited to code this slice added or changed (S6).** The "Existing code the new code reveals as problematic" item is gone from `refactoring.md`. Smells elsewhere become observations.
- **Plan gaps (S10, S11, S13).** If a slice can't be built without a file outside the scope, the agent leaves the file alone and marks the slice `blocked` (failing test kept, `blocked: <plan task>` commit), and lists the file in the slice's `scopeGaps: [{file, why}]`. Anything else it notices goes in `observations: [{file, detail}]`, which never widens the scope. Both are self-reported; nothing checks them against git.
- **`Tests: none` (S17).** Such a task is built without RED and reported `unitTest: "skipped"`. Not checked against the plan.
- **Inputs.** `unitTests` (S18), and `commitFormat`, defaulting to today's `<plan task>[ (<scenario>)]` (S46). Target repos may parse commit messages (devplatform's semantic-release reads `[<agent-name>: ]<type>: <subject>`).
- **Reads (S9).** SKILL.md says implement-tdd may read only the plan's files, the `.adw/` inputs and the scenarios. Not enforced.

### Removed (2026-11-20)
- **Scope guard.** A `write`/`edit` pre-block on files outside the scope, plus a report check that compared `git diff <startHead>` and `git status` with the scope and rejected the report until out-of-scope changes were reverted. It needed frozen per-run state, credential-free git reads, new-file rules and `failed.kind: "invalid-plan" | "invalid-state"`. Too much to keep in your head for what it bought. Gone with it: `checkReport`'s gap-equals-observed rule, the derived `unplannedNewFiles`/`noneTasks` details, and `failed.kind`.
- **Target-repo isolation.** Launch flags (`--no-approve -ne -ns -nc`), a credential-free environment, a pinned provider and `npm run check:isolation` with a canary fixture. Nothing launched pi with them, and with the guard gone there was little left for a target repo's extensions to disable.
- Neither is on `main`. The guard survives in the unreferenced commit `af30a09` (reflog only, so git will eventually prune it). Isolation was never committed. Temporary copies of both are in `/tmp/extensions-before-guard-removal/` and `/tmp/isolation-removed/`.

### Facts worth keeping
- **Credentials leak past an emptied environment.** Dropping token variables doesn't make an agent credential-free: git got a GitHub password from the system `credential.helper` (`osxkeychain`, verified with `git credential fill`), and `gh` from `~/.config/gh/hosts.yml`. `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` and an empty `GH_CONFIG_DIR` stopped both. An agent can still set a helper in the repo's own config or use an SSH key, so only an OS boundary (container or separate user) closes it.
- **What a target repo can inject.** pi loads one context file per directory (`AGENTS.override.md`, then `AGENTS.md`, then `CLAUDE.md`) whatever the trust setting; only `-nc` stops it. Once the project is trusted, its `.pi/extensions`, skills, `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md` load too. The pi-claude-code provider (read at `d5b5e04`) already starts Claude Code with `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `--setting-sources ""`.
- **Testing a pi run without a model.** pi reaches `before_agent_start` and `ctx.abort()` stops it before any provider call, but pi still needs a model it can select (a placeholder provider works).

## write-scenarios skill (replaces commands/scenario_writer.md and generate_step_definitions.md)

The skill writes all four layers (Gherkin, steps, DSL, `Driver` interfaces with stub drivers) and runs in parallel with plan-issue, before alignment. It has full autonomy over `features/`, but never promotes to regression, and regression files carry no tags. It runs nothing; a verifier checks its output. Neither it nor plan-issue commits, and skill-path-guard blocks `git commit` in both.

### Report
- `report_scenarios` (`.pi/extensions/write-scenarios/`). Its `reportTool.ts` is a deliberate copy of implement-tdd's (WET over DRY).
- **`regressionTouched` is derived, not reported (Q52).** The report schema deliberately has no such flag. The orchestrator sets it when any `changes[].file` lies under `## Regression Scenario Directory` or `vocabularyAdded` is non-empty, and then applies `hitl`, so a human approves the regression or vocabulary change at merge. This mirrors ADW's gate for vocabulary changes, where only a `hitl`-labelled promotion issue registers phrases (ADR-0049, `adws/core/promotionIssueBody.ts`).
- **`scenarios`** (`[{file, scenario}]`) feeds implement-tdd's `scenarios` input, which replaced `scenarioFiles`.
- **No phrase gaps in the report.** The report has `newTerms` (domain terms the model coined because `UBIQUITOUS_LANGUAGE.md` lacks them), not `vocabularyGaps`. Unregistered step phrases matter only at promotion, and code finds them there: ADW's `promotionScorer` matches each step against the registry, and `promotionSweep` (`dedupedPhrases`) lists the phrases to register in the promotion issue. In ADW, the model-reported gaps (`scenario_writer` output, `generate_step_definitions`' `vocabularyViolations`) were never read by any code.

### Orchestrator
- Skip labels: `regression-promotion` and `adw:none` (ADW `scenarioAuthoringSkipReason`).
- Comment filtering (human comments only, the actionable comment) stays in the orchestrator.
- The runner mode comes from `## Application Type` for now (`web` → playwright-bdd, anything else → the `## BDD Framework` runner).

### Alignment
- The alignment phase doesn't edit scenarios itself. When a misalignment comes from the scenarios, it re-invokes write-scenarios with `alignmentFindings: [{scenario?, instruction}]`, and the skill changes only what the findings name.

### Config (done)
- `.adw/scenarios.md`: `## Step Def Directory: features/steps`, plus `## DSL Directory` and `## Driver Directory`. `## Run Regression Scenarios` is now `cucumber-js --profile regression`, using a new `regression` profile in `cucumber.json` that selects `features/regression/**/*.feature` by path.
  - Verified: a path given on the command line does **not** override `paths` in the config. A dry run with `features/regression/` ran 2 scenarios, not 1. The profile ran exactly 1.

### skill-path-guard (done)
- `.pi/extensions/skill-path-guard/`: one policy table for plan-issue, write-scenarios and implement-tdd. It activates on the expanded `/skill:<name>` prompt and keeps the policy for later plain prompts in the session. It turns on pi's built-in `grep`/`find`/`ls`, resolves paths with `realpath`, and blocks paths outside the worktree and paths it cannot resolve. The skill's own directory stays readable.
  - write-scenarios may read `features/**`, `README.md`, `app_docs/**`, `.adw/**`, `UBIQUITOUS_LANGUAGE.md`, `guidelines/coding_guidelines.md`, the root runner configs (`cucumber.js` etc.) and `specs/prd/**`. It may not read the plans (`specs/issue-*`, a prefix root). It writes only under `features/`, and its bash is limited to `git status|diff|log|show` with paths only under `features/`.
  - **Q2 refined after the vestmatic test:** the PRDs under `specs/prd/` are requirements an issue may name as its parent, so write-scenarios may read them. Only the plans stay hidden.
  - implement-tdd may not write or edit under `features/`. Its bash is not fenced, so its skill keeps the rule "never change the scenario tree through bash". Its scope within the plan is left to the prompt (see Plan scope).
  - Listing and searching (`ls`/`find`/`grep`) are allowed on parents of denied roots. A `tool_result` hook removes what lies inside denied roots from the output (entries for `ls`/`find`; match and context lines, which pi prefixes with the path, for `grep`), so a search from `.` cannot name or quote the plans or, for plan-issue, the scenario tree. Checked against pi's real `find`/`ls`/`grep` output on vestmatic clones. Hidden matches still count against grep's match and byte limits; the notice says how many were hidden.
  - The guard drops a search tool's `path` of `"null"` or `""` (models fill the optional argument that way; fd then fails on a directory named `null`).
  - The guard uses the literal `features/`, not `## Scenario Directory`.
- **plan-issue A/B rerun with the guard (`/tmp/abtest/REPORT-run2.md`):** 9/9 plans kept the template and the run-1 findings, at $7.23 vs $8.55 and 1337 s vs 1833 s. Adverse effects fixed after it: repo-wide `grep` was blocked (now filtered), `path: "null"` failed `find`, and 5/9 plans still scheduled `features/` work they could no longer see, which implement-tdd may not write. plan-issue now says BDD belongs to the scenario writer and test tasks are unit tests. Confirmed by a rerun of the 5 affected issues (78, 164, 212, 54, 239; run 3, `claude-code` provider, same model and thinking): 0/5 plans create or change anything under `features/`, test tasks are unit tests (`node:test` or Vitest), no `path: "null"` failures, repo-wide grep ran with hidden-line notices, and the key findings held (78's 20 fonts, 54's Vitest and engine split, 239's `codegen.js` cleanup).

## Extensions layout
- One folder per skill under `.pi/extensions/` (`index.ts` plus its own helpers and `__tests__/`). WET over DRY: `shared/` holds only `skillSession.ts`, `worktreePaths.ts` and the test helper `fakePi.ts`. Tests run with Vitest; `tsconfig.extensions.json` type-checks the folders.
