# Grill Notes

Decisions deferred or parked during grills. Read this before starting a new grill.

## plan-issue skill (replaces commands/bug.md, chore.md, feature.md)

### Deferred: moves once the orchestrator / WorkflowNode exist
- **Metadata and plan path → orchestrator.** The orchestrator computes `planPath` and writes `# <Type>: <name>` + `## Metadata` (checks the header with `^# (Bug|Chore|Feature): .+$`). The agent stops copying `issueJson`. Then `correctPlanFileNaming` in the old ADW can go.
- **Prose rules → `tool_call` hooks. Done in `.pi/extensions/skill-path-guard.ts`** (see write-scenarios below); the prose rules are gone from the skill:
  - `write`/`edit` only under `specs/`. Still deferred: narrowing that to the exact `planPath` once the orchestrator computes it.
  - bash allowlist `git (log|show|diff|blame)` only. It rejects shell metacharacters, quotes, global git options (so `-c` too), `--output`, `--ext-diff`, `--textconv`, `--no-index`, `--contents` and `-L`.
  - no reads under **all of `features/`**, widened from `features/per-issue/` because write-scenarios now writes steps, DSL and drivers there too. `git log/show/diff` get `:(exclude)features/` appended, and `grep` over a parent of `features/` is blocked.
- **Deterministic work → verifiers.** Running unit tests, `## Validation Commands`, and plan structure checks (header, required sections per type, Relevant Files paths exist). Planning test-*writing* tasks stays in the skill.
- **`unitTests` resolved by code.** Pass in a boolean instead of having the LLM parse `.github/adw.yml`.
- **Retry on verifier failure.** Proposed: one retry with the verifier's reason fed back, then fail the phase. Not decided.

### AGENTS.md (deferred)
- Use a managed block between `<!-- adw:begin -->` and `<!-- adw:end -->`, keeping human content outside it. Agreed as the right direction.
- Pi loads only ONE context file per directory, first match of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` (verified: `pi-coding-agent/dist/core/resource-loader.js:115-133`). Adding AGENTS.md silently hides an existing CLAUDE.md. Proposed: move CLAUDE.md content into AGENTS.md and make CLAUDE.md a pointer. Not decided.
- AGENTS.md is loaded by every agent in the cwd (implementer, reviewer, humans), so it holds only universal facts, never planner rules.
- Open: generated from `.adw/` (with a staleness hash) vs hand-written index of `.adw/` files. It must live in the target repo, because the planner's cwd is the target worktree.

### Parked
- `.pi/presets.json` is inert (no extension reads it). Its `plan` preset contradicts the planner needing `write`.
- `.pi/extensions/multi-model-hooks.ts` injects model-specific instructions (`before_agent_start`) that also reach the planner.
- Other agents (`implement`, `review`, `test`, `scenario_writer`, ...) read `.adw/*.md` themselves. Trim once AGENTS.md exists.
- `pr_review.md` and `patch.md` are also plan-shaped and could be folded into `plan-issue` later.
- How to check the new skill: proposed A/B on 3 past issues (one per type), old vs new plan, judged by a human.

## implement-tdd skill (rewrite of ADW's `.claude/skills/implement-tdd`)

The skill does unit-level TDD only. It treats the scenario directory as read-only and never runs scenarios. Everything below was decided during the grill but lives outside the skill.

### Upstream owns the scenario layers ("what" fixed early, "how" deferred)
- **Author.** Upstream writes the Gherkin, the step definitions, the DSL verbs, the `Driver` interface and the stub drivers. **Settled: the `write-scenarios` skill** (see below). It must never be the implementing agent.
- **Layering** (Farley's four layers). Steps call domain-level DSL verbs, and the DSL calls a typed `Driver` interface. Stub drivers throw `NotImplemented("<method>")`.
- **Assertions** and expected values live only in steps and the DSL. Drivers only act and return observations: no `expect` calls, no constants that come from the scenario. This is the guard against bending the test to fit the implementation.
- **The `Driver` interface describes the test's needs, not the app's design.** The app never implements it. The unit tests shape the app's design.
- **Config.** `.adw/scenarios.md` gets `## DSL Directory` and `## Driver Directory`, defaulting to `features/support/dsl/` and `features/support/drivers/`. Done.
- **Moves upstream from `generate_step_definitions` / `stepDefPhase`:** framework idiom, Step Def Directory, the duplicate-pattern ban, vocabulary registry validation, and the runner mode. The runner mode comes from `## Application Type` in `.adw/project.md` (`cli` → descriptor, `web` → adw_playwright, `mobile:kotlincm` → descriptor + devices; see ADW `adws/core/applicationType.ts`). `stepDefPhase` is dropped.

### Drivers and scenario runs (future skill)
- A separate skill fills in the drivers once the implementation exists. A *different* agent runs it, not the implementer.
- That skill also owns **hermetic test mode** (formerly §8 of implement-tdd): a test-mode switch, stubbed externals, seeded data and a deterministic clock.
- The verifier runs the scenarios. RED and GREEN at scenario level happen there, not in implement-tdd.
- ADW found (verified: `scenarioTestPhase.ts:241`) that only the scenario test phase receives `ADW_APPLICATION_URL` and the device env variables. The build phase never could run browser or device scenarios.

### Alignment and failure loop
- Plan/scenario alignment happens upstream, before the build.
- implement-tdd fails hard on misalignment and reports `failed: {scenario, planTask, conflict}`. The orchestrator should then loop back to the alignment phase.

### WorkflowNode validation step
- Finish checks are not part of the skill: the full unit suite, `## Type Check` and `## Run Linter`. A WorkflowNode validation step runs them after implement-tdd.
- Still open: whether failures in files the agent never touched are reported separately as pre-existing.

### Commits and resume
- implement-tdd commits once per slice (`<plan task>[ (<scenario>)]`, or `blocked: <plan task>`) and never pushes. Resume reads `git log` to find finished slices.

### Validation of the rewrite
- Replay 2 past ADW issues with `@adw-N` scenarios in throwaway worktrees. Compare the JSON report and a human review of the diff against the original runs. Scenario results are not compared.

### Findings input and JSON repair
- **Findings.** implement-tdd takes an optional labelled `findings` list (`source`, `file?`, `detail`) from the WorkflowNode validator. Each finding becomes an extra slice after the plan slices, and findings never override the skill's Rules. Free-form prompt input was rejected because it invites scope creep.
- **Report via tool, not raw JSON (decided).** `.pi/extensions/implement-tdd-report.ts` registers `report_implementation`, whose TypeBox schema is the single source of truth for the report (exported as `ImplementationReport`).
  - Pi validates the arguments against the schema and returns errors to the model as a failed tool call, so the model retries in the same session. `execute()` rejects what the schema cannot express: exactly one of `planTask`/`finding`, `reason` on `blocked`, `skipped` iff `tdd: false` (or a non-behaviour finding).
  - `constrainedSampling: { type: "json_schema", strict: "prefer" }` turns on provider-side strict tools where available; keep the schema strict-compatible (no `oneOf`/`allOf`, no object unions, no `minLength`).
  - Scope: registered with `defaultActive: false`. It becomes active only when a run's prompt is the expanded `/skill:implement-tdd` block (`<skill name="implement-tdd"`), and is restored on resume from the session branch. No other session sees it.
  - The accepted report is in the tool result's `details` / `structuredContent`; the call returns `terminate: true`. The orchestrator reads it from there, not from the last message.
  - If a run ends without an accepted report, `agent_before_settle` sends a reminder and continues, at most twice. This replaces the planned `sendUserMessage()` JSON repair.
- **Open:** the retry budget, i.e. how many times the validator may re-invoke implement-tdd with findings. See the "one retry" proposal under plan-issue.

## write-scenarios skill (replaces commands/scenario_writer.md and generate_step_definitions.md)

The skill writes all four layers (Gherkin, steps, DSL, `Driver` interfaces with stub drivers) and runs in parallel with plan-issue, before alignment. It has full autonomy over `features/`, but never promotes to regression, and regression files carry no tags. It reports through the `report_scenarios` tool (`.pi/extensions/write-scenarios-report.ts`). The tool reuses the shared factory `utils/skillReport.ts`, and `implement-tdd-report.ts` now wraps the same factory.

### Deferred: orchestrator
- **`regressionTouched` is derived, not reported (Q52).** The report schema deliberately has no such flag. The orchestrator sets it when any `changes[].file` lies under `## Regression Scenario Directory` or `vocabularyAdded` is non-empty. It then applies `hitl`, so a human approves the regression or vocabulary change at merge. This mirrors ADW's gate for vocabulary changes, where only a `hitl`-labelled promotion issue registers phrases (ADR-0049, `adws/core/promotionIssueBody.ts`).
- Pass `report_scenarios.scenarios` to implement-tdd as its new `scenarios` input (`[{file, scenario}]`, which replaced `scenarioFiles`).
- Do not invoke the skill for issues labelled `regression-promotion` or `adw:none` (ADW `scenarioAuthoringSkipReason`). For chores, the orchestrator decides.
- Commit once both plan-issue and write-scenarios have finished. Neither skill commits, and the guard blocks `git commit` in both.
- Comment filtering (human comments only, the actionable comment) stays in the orchestrator.
- The runner mode comes from `## Application Type` for now (`web` → playwright-bdd, anything else → the `## BDD Framework` runner). It should become an orchestrator input, like `unitTests`.

- **No phrase gaps in the report.** The report has `newTerms` (domain terms the model coined because `UBIQUITOUS_LANGUAGE.md` lacks them), not `vocabularyGaps`. Unregistered step phrases matter only at promotion, and code finds them there: ADW's `promotionScorer` matches each step against the registry, and `promotionSweep` (`dedupedPhrases`) lists the phrases to register in the promotion issue. In ADW, the model-reported gaps (`scenario_writer` output, `generate_step_definitions`' `vocabularyViolations`) were never read by any code.
- Who maintains `UBIQUITOUS_LANGUAGE.md` from `newTerms` is open. If nobody does, drop the field.

### Deferred: alignment
- The alignment phase no longer edits scenarios itself. When a misalignment comes from the scenarios, it re-invokes write-scenarios with `alignmentFindings: [{scenario?, instruction}]`, and the skill changes only what the findings name.
- **Open:** the redirect budget, i.e. how many times alignment may re-invoke write-scenarios.
- **Open (found while writing the skill):** what write-scenarios reports when it cannot apply a finding without breaking one of its Rules. `failed` means "wrote nothing", which does not fit a redirect where scenarios already exist. This needs a report field (e.g. `rejectedFindings`) or an explicit rule.

### Deferred: WorkflowNode verifier
- The skill runs nothing. The verifier runs the type check over `features/` and `cucumber-js --dry-run`, which catches undefined and ambiguous steps. In web mode it runs the guarded `cd features && (test -d node_modules || npm ci) && npx bddgen` instead.

### Deferred: drivers skill
- Implements every `driverMethods` entry (the stubs throw `NotImplemented("<Area>Driver.<method>")`). Swaps the stubs for real drivers in `features/support/drivers/index.ts`. Fills the `TBD (driver)` `Pattern` and `Assertion target` columns of newly registered phrases.
- Owns mobile and device runs, screenshots, the `ADW_*` environment and hermetic test mode. Rot is judged there, on the real drivers.

### Done outside the skill
- `.adw/scenarios.md`: `## Step Def Directory: features/steps`, plus `## DSL Directory` and `## Driver Directory`. `## Run Regression Scenarios` is now `cucumber-js --profile regression`, using a new `regression` profile in `cucumber.json` that selects `features/regression/**/*.feature` by path.
  - Verified: a path given on the command line does **not** override `paths` in the config. A dry run with `features/regression/` ran 2 scenarios, not 1. The profile ran exactly 1.
- `skill-path-guard.ts`: one policy table for plan-issue, write-scenarios and implement-tdd. It activates on the expanded `/skill:<name>` prompt and keeps the policy for later plain prompts in the session. It turns on pi's built-in `grep`/`find`/`ls`, resolves paths with `realpath`, and blocks paths outside the worktree and paths it cannot resolve. The skill's own directory stays readable.
  - write-scenarios may read `features/**`, `README.md`, `app_docs/**`, `.adw/**`, `UBIQUITOUS_LANGUAGE.md`, `guidelines/coding_guidelines.md`, the root runner configs (`cucumber.js` etc.) and `specs/prd/**`. It may not read the plans (`specs/issue-*`, a prefix root). It writes only under `features/`, and its bash is limited to `git status|diff|log|show` with paths only under `features/`.
  - **Q2 refined after the vestmatic test:** the PRDs under `specs/prd/` are requirements an issue may name as its parent, so write-scenarios may read them. Only the plans stay hidden.
  - implement-tdd may not write or edit under `features/`.
- Tests in `.pi/extensions/__tests__/`, run by Vitest. `tsconfig.extensions.json` type-checks the new extension files.

### Parked / found
- Guard limits:
  - implement-tdd's bash is not fenced, so its skill keeps the rule "never change the scenario tree through bash".
  - Listing (`ls`/`find`) is allowed on parents of denied roots. A `tool_result` hook removes the entries inside denied roots from the output, so a `find` from `.` cannot name the plans or, for plan-issue, the scenario tree. Checked against pi's real `find`/`ls` output on a vestmatic clone.
  - The guard uses the literal `features/`, not `## Scenario Directory`.
- `.pi/extensions/multi-model-hooks.ts` imports `@mariozechner/pi-coding-agent`, the old package name, and `tsc` cannot resolve it. Hypothesis: it fails to load under pi 1.4. Check: start pi and read the startup diagnostics. `btw.ts` also fails the strict type check.
- `commands/scenario_writer.md` and `commands/generate_step_definitions.md` remain until the orchestrator switches to the skill.
- Check plan for the skill: replay 2 past ADW issues with `@adw-N` scenarios in throwaway worktrees, run the verifier (type check plus dry run), and have a human compare coverage and domain language with the original scenarios.
