# Grill Notes

Decisions deferred or parked during grills. Read this before starting a new grill.

## plan-issue skill (replaces commands/bug.md, chore.md, feature.md)

### Deferred: moves once the orchestrator / WorkflowNode exist
- **Metadata and plan path → orchestrator.** The orchestrator computes `planPath` and writes `# <Type>: <name>` + `## Metadata` (checks the header with `^# (Bug|Chore|Feature): .+$`). The agent stops copying `issueJson`. Then `correctPlanFileNaming` in the old ADW can go.
- **Prose rules → WorkflowNode verifiers / `tool_call` hooks.** "Read-only research", "write only the plan file" and "stop once written, ignore `features/`" become enforced:
  - block `write`/`edit` outside `planPath`;
  - bash allowlist `git (log|show|diff|blame)` only, rejecting shell metacharacters, `--output`, `--ext-diff`, `--textconv` and `-c`;
  - block reads of the per-issue scenario directory (`features/per-issue/`).
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
- **Author.** Upstream writes the Gherkin, the step definitions, the DSL verbs, the `Driver` interface and the stub drivers: `scenario_writer` or a skill right after it. The exact owner is open. It must never be the implementing agent.
- **Layering** (Farley's four layers). Steps call domain-level DSL verbs, and the DSL calls a typed `Driver` interface. Stub drivers throw `NotImplemented("<method>")`.
- **Assertions** and expected values live only in steps and the DSL. Drivers only act and return observations: no `expect` calls, no constants that come from the scenario. This is the guard against bending the test to fit the implementation.
- **The `Driver` interface describes the test's needs, not the app's design.** The app never implements it. The unit tests shape the app's design.
- **Config.** `.adw/scenarios.md` gets `## DSL Directory` and `## Driver Directory`, defaulting to `features/support/dsl/` and `features/support/drivers/`.
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
