# Handoff — ADW `.adw/` + Pi Skills

Written at the end of a session that studied two things:
1. How Pi's **skills** mechanism works (per Pi's own docs).
2. What lives in `../AI_Dev_Workflow/.adw/` and how ADW's planner/agents consume it.

The point of this handoff is so a future session can skip the re-reading and go
straight to work. The user has flagged that the 16 numbered Markdown files
under `./rewrite/` **become interesting later** — do not open them until the
user brings them up. They were not read in this session.

---

## 1. Where we are

- CWD: `/Users/martin/projects/paysdoc/Pi_Dev_Workflow`
- This repo is a fresh Node 20 + TypeScript (ESM) scaffold with Vitest and
  Cucumber already wired. See `README.md`. The example code is a `Calculator`
  module — placeholder, meant to be replaced.
- Sibling repo: `../AI_Dev_Workflow` — the existing ADW system (TypeScript/Bun,
  Claude Code CLI driven). This is the system whose configuration surface
  (`.adw/`) we studied.
- `./rewrite/` holds 16 numbered chapter-style docs (`01-config-and-environment.md`
  through `16-supply-chain.md`), a Python deck builder, images, and a generated
  `.pptx`. **Not yet read.** Treat them as the brief for a future rewrite effort.
- `./.pi/` exists with `extensions/` and `presets.json`. Not inspected in detail.
- `./MULTI_MODEL_HOOKS.md` exists at root. Not read in this session.

The naming ("Pi_Dev_Workflow" next to "AI_Dev_Workflow") strongly implies the
goal is a Pi-native reimplementation of ADW, but the user has not stated this
explicitly. Do not assume scope — ask.

---

## 2. How Pi skills work (summary of `docs/skills.md`)

Skills sit between prompt templates (text only) and extensions (executable
integration points). They are a **lazy-loaded instruction bundle**.

**Shape.** A directory with `SKILL.md`, optionally bundling `scripts/`,
`references/`, `assets/`. Frontmatter fields (Agent Skills spec):
`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`,
`disable-model-invocation`. Names: lowercase, hyphens, ≤64 chars.
Descriptions: ≤1024 chars.

**Core mechanic.** At startup Pi injects only each skill's **name,
description, and path** into the system prompt. The model reads the full
`SKILL.md` only when a task matches. Routing quality depends entirely on the
description — it must say both *what* the skill does and *when* it applies.

**Invocation.** Automatic (model-chosen) or explicit via `/skill:<name> <args>`,
where args are appended as a user request. `disable-model-invocation: true`
makes a skill reachable only through the explicit command.

**Discovery locations.** User and project skills dirs (see
`docs/settings.md#resources`), plus Agent Skills standard paths
`~/.agents/skills/` and `.agents/skills/`. Project `.agents/skills/` is
searched from CWD up through ancestors, stopping at the repo root. Pi packages
(`docs/packages.md`) can distribute skills via npm or git. Directories with
`SKILL.md` are discovered recursively.

**Operational notes.** Malformed `SKILL.md` or missing description → silently
skipped. Name collisions → first wins + warning. Run `/reload` after editing
during an active session. Project skills can run scripts; review before
trusting.

Reference collections: anthropics/skills and badlogic/pi-skills.

---

## 3. What `../AI_Dev_Workflow/.adw/` is

Not code. It is the **project-level configuration + routing surface** that
ADW's planner reads before every task. All six files are plain Markdown parsed
as `## Heading` → value. The directory tells ADW three things: *what this repo
is*, *how to behave in it*, and *which deeper docs to pull into context when
touching specific files*.

### File-by-file

| File | Purpose | Key contents |
|---|---|---|
| `project.md` | Repo identity + file map | Overview; `Relevant Files` map of `adws/{core,agents,phases,forge,vcs,triggers,r2}/**`, `.claude/commands/**`, `.adw/**`; notes `@paysdoc/devplatform` is an npm dep consumed via `.`, `./providers`, `./git`; `Application Type: cli`; `Agent Guardrails` note that the repo's existing `.claude/settings.json` was deliberately left untouched (skip-if-exists). |
| `commands.md` | Fixed-schema command registry | `Package Manager: bun`; install/lint/typecheck/test/build commands; `bunx tsc --noEmit` (plus `-p adws/tsconfig.json`); `Test Framework: vitest`; `Test Directory: test`; `Script Execution: bunx tsx <script_name>`; `Health Check Path: /`; `Start Dev Server: N/A`; Cucumber: `NODE_OPTIONS="--import tsx" bunx cucumber-js` with `@{tag}` and `@regression` variants. |
| `providers.md` | Forge wiring | `Code Host: github` @ `https://github.com`; `Issue Tracker: github` @ `https://github.com`; empty `Issue Tracker Project Key`. Maps to the IssueTracker/CodeHost ports from `@paysdoc/devplatform/providers`. |
| `scenarios.md` | BDD contract | Base: `Scenario Directory: features/`, `BDD Framework: cucumber-js`, `Step Def Directory: features/step_definitions`. **Opt-in trio** (all three → stricter mode): `Per-Issue Scenario Directory: features/per-issue/` (routes `scenario_writer`), `Regression Scenario Directory: features/regression/` (disables `@regression` auto-promotion), `Vocabulary Registry: features/regression/vocabulary.md` (phrase validation in `generate_step_definitions`). |
| `coding_guidelines.md` | House style enforced on generated code | Max file ~300 lines, strict TS, no `any`. **Nesting discipline** (max depth 2; guard clauses; extract loop bodies; invert conditions; inline callbacks >3 lines must be named). **Testing split**: BDD scenarios are *independent proof* written by a different agent; Vitest unit tests (co-located `__tests__/`) are written by the implementing agent and never substitute for scenario proof. Gate: `unitTests` in `.github/adw.yml`. **Comments**: only explain invariants/non-obvious choices; no restating code, no banners, no issue-number citations, no JSDoc on self-describing names. |
| `conditional_docs.md` | Lazy-load routing table (1100 lines, **47 entries**) | Each entry: `- app_docs/feature-<slug>.md` with sub-lists `Owns:` (file paths this doc covers, incl. co-located tests), `Conditions:` (natural-language topic triggers), `Decisions:` (ADR numbers). Nearly all entries share the `feature-9gjajh-*` prefix (one generation run); later additions: `feature-oqb76h-gitcontext-base-path-authority`, `feature-m363ky-comment-only-guard`, `feature-gfv9kt-application-type-mapping`, `feature-2u517h-adw-playwright-project`. Two entries lack a Decisions block (`specs-and-prd`, `pr-and-document-agents`); all others carry ≥1 ADR. |

### How ADW uses these at task time
1. Read `project.md` for orientation + application type.
2. Read `providers.md` to pick the forge adapter.
3. Read `commands.md` for build/lint/test/typecheck invocations.
4. Read `coding_guidelines.md` for style the generated code must satisfy.
5. Scan `conditional_docs.md`: match edited paths against **Owns** and task
   description against **Conditions**; lazy-load only the matching
   `app_docs/feature-*.md` plus referenced ADRs — not all 47.
6. For BDD work, consult `scenarios.md` to pick per-issue vs regression
   directory and whether vocabulary validation is active.

---

## 4. Mental model: `.adw/` ↔ Pi

The ADW config surface and Pi's primitives overlap but are not isomorphic.
When the rewrite starts, these are the likely mappings — treat as hypotheses,
not decisions:

| ADW concept | Closest Pi primitive | Notes |
|---|---|---|
| `project.md` orientation + file map | Project-level system prompt or a top-level skill | Pi has no single mandatory "project.md"; the equivalent is whatever is loaded into the base context. |
| `commands.md` command registry | Could be a skill with scripts, or extension-provided tools | Pi doesn't have a fixed schema for this today. |
| `providers.md` forge wiring | Extension configuration | Pi extensions are the natural home for pluggable integrations (`docs/extensions.md`, `examples/extensions/`). |
| `scenarios.md` BDD contract | Skill (`disable-model-invocation` candidate) | Routing is behavioural, not file-based. |
| `coding_guidelines.md` | Always-on skill or injected context | If description-routed, risks being skipped on tasks that should obey it. Likely wants to be baseline context, not a skill. |
| `conditional_docs.md` 47-entry routing table | **This is the real design question.** It is already a lazy-load table keyed on file ownership + topical conditions. Pi skills route only on `description`. A faithful port either (a) encodes each `app_docs/feature-*.md` as a skill with a description built from the Conditions, losing the Owns file-path index, or (b) builds a Pi extension that performs file→doc routing itself. | Worth revisiting after reading `./rewrite/`. |

---

## 5. What to read first in the next session

If the user says "start the rewrite" or similar:

1. **`./rewrite/01-config-and-environment.md` → `16-supply-chain.md`** — the
   16 chapters. These are the brief. Read in order; they total ~170 KB.
2. **`./rewrite/suggestions.txt`** (19 KB) — likely contains the author's
   notes on desired changes.
3. **`./MULTI_MODEL_HOOKS.md`** at repo root — not yet read; implied relevant.
4. **`./.pi/presets.json`** and **`./.pi/extensions/`** — the Pi configuration
   already present in this repo.
5. Pi reference docs when a mechanism is in play:
   - `docs/skills.md` (summarized above)
   - `docs/extensions.md` + `examples/extensions/` (for provider/tool work)
   - `docs/prompt-templates.md`
   - `docs/packages.md` (for distribution)
   - `docs/codemode.md` (if non-LLM scripts/classifiers come up)

Do **not** re-derive the `.adw/` summary — it is above and complete to the
level needed to start design work. If deeper detail is wanted, the originals
are at `../AI_Dev_Workflow/.adw/`.

---

## 6. Open questions to put to the user before coding

- Is the goal a Pi-native reimplementation of ADW, a thin Pi wrapper over
  the existing ADW, or something else?
- Should `.adw/`-style config be preserved as-is (and parsed by a Pi
  extension), or replaced with Pi-native primitives (skills + extension
  config)?
- Is the 47-entry `conditional_docs.md` routing table something to port
  faithfully, or an artifact to replace?
- Scope of the rewrite: all of `adws/**`, or specific subsystems from the 16
  chapters?
