---
name: implement-tdd
description: "Implements a plan test-first: unit tests drive red-green-refactor, one slice per plan task, using the `@adw-{issueNumber}` scenarios (read-only) as the spec of what to build. Invoked with labelled inputs; not for interactive use."
disable-model-invocation: true
---

# Implement a plan test-first

You implement a plan one slice at a time. Unit tests drive each slice through red-green-refactor. The BDD scenarios tell you *what* to build. You never edit or run them.

## Inputs

The request contains labelled values. Use them by label, never by position.

- `issueNumber`: numeric issue number
- `planPath`: path to the plan file
- `scenarioFiles` (optional): the `.feature` files for this issue. If absent, find every `.feature` file under the scenario directory tagged `@adw-{issueNumber}`.
- `findings` (optional): a list of items, each with `source`, an optional `file`, and `detail`. They come from a validator that checked an earlier run. See **Findings**.

## Read first

1. The plan at `planPath`, in full.
2. `.adw/commands.md`: `## Run Tests` and `## Test Framework`.
3. `.adw/coding_guidelines.md`: your code and tests must comply.
4. `.adw/scenarios.md`: `## Scenario Directory` (default `features/`). This is the scenario directory.
5. `.github/adw.yml`: unit tests are off only when an uncommented line sets `unitTests: false`. They are on if the file or the key is missing.
6. The scenario files, plus the step definitions, DSL and drivers behind them, if any.

You may read only the files above, any file the plan or a finding names, and the files you create.

## Rules

- Everything under the scenario directory is read-only: `.feature` files, step definitions, DSL and drivers. Never add, edit or delete anything there, and never run scenarios.
- Scenarios define *what* to build. The plan defines *where* and *how*. If a scenario has no step definitions or DSL behind it, its Gherkin text together with the plan is the spec, and its slice gets `reason: "no upstream DSL"`.
- **Misalignment is a hard fail.** Stop at once if the plan and a scenario specify contradictory behaviour, or if no plan task implements a scenario. Write no more code and report `failed`.
- Run only the unit tests you write. Do not run the full suite, the type checker or the linter.
- Commit after each slice. Never push.

## Slices

There is one slice per task in the plan's step-by-step tasks, in plan order. Attach each scenario to the first task that implements it. A task that no scenario covers gets `scenario: null`.

For each slice:

1. **RED**: Write a unit test for the slice's behaviour. Add the minimal export it needs so it compiles: the signature, throwing or returning a placeholder. Run the test and confirm it fails at an assertion. An import, compile or resolution error is not RED. Fix it and run the test again.
2. If the test passes before you write any code, tighten it once so it asserts the new behaviour. If it still passes, mark the slice `passed-before-implementation` and carry on.
3. **GREEN**: Write the minimal code that makes the test pass, then run it.
4. **REFACTOR**: Clean up using [refactoring.md](refactoring.md). Rerun the test after each step, and never refactor while it is red.
5. **Commit** with the plan task as the message, plus ` (<scenario name>)` when the slice has a scenario.

If a slice cannot reach GREEN within the plan's scope, keep its failing test. Commit it as `blocked: <plan task>`, mark the slice `blocked` with the reason, and move on to the next slice.

If unit tests are off, do steps 3–5 without tests. Report `"tdd": false` and mark every slice's `unitTest` as `"skipped"`.

Write tests following [tests.md](tests.md) and mock only at system boundaries following [mocking.md](mocking.md). Shape code using [interface-design.md](interface-design.md) and [deep-modules.md](deep-modules.md).

## Findings

After the plan slices, handle each finding as one more slice, in the order given:

- If the finding is about behaviour, start with RED: write a test that captures it and fails. Then do GREEN, REFACTOR and commit as above, with the commit message `finding: <detail>`.
- If the finding is not about behaviour (for example a lint or type error), fix it without a test, commit as `finding: <detail>`, and mark it `unitTest: "skipped"`.
- A finding never overrides **Rules**. If handling it would break a rule, do not act on it. Mark it `blocked` with the rule named, and carry on.

## Resume

You may be restarting an earlier run. Before the first slice, read `git log`, `git status` and `git diff`. Slices with a commit are done. Uncommitted changes belong to the first slice that is not done, so continue that slice from where its test stands. Report each slice that was done before the restart with the status its commit and test show.

## Output

Finish by calling the `report_implementation` tool exactly once, after the last commit. Its schema defines the report. Do not write the report as text.

- `slices`: one entry per slice, plan tasks first in plan order, then findings in the order given. Each slice sets exactly one of `planTask` and `finding`; the other is `null`.
- `reason`: required for a `blocked` slice. Otherwise `"no upstream DSL"` or `null`.
- On a misalignment, set `failed` and list only the slices done so far.

If the tool rejects the report, fix what the error names and call it again.
