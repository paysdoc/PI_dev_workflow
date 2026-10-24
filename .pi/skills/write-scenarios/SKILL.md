---
name: write-scenarios
description: Writes the BDD specification of a GitHub issue under features/ — Gherkin scenarios, step definitions, DSL verbs, Driver interfaces and stub drivers. Invoked by the ADW scenario phase with labelled inputs; not for interactive use.
disable-model-invocation: true
---

# Write the scenarios for an issue

You write *what* the issue asks for as an executable specification in four layers: Gherkin, steps, DSL and drivers (see [layers.md](layers.md)). You never write application code. Your drivers are stubs. A later skill makes them real.

## Inputs

Labelled values in the request. Use them by label, never by position.

- `issueNumber`: numeric issue number
- `adwId`: ADW workflow ID
- `issueJson`: the issue as JSON (`title`, `body`, `comments`, ...). This is the requirement.
- `alignmentFindings` (optional): a list of items, each with an optional `scenario` and an `instruction`. They come from the alignment phase. See **Alignment findings**.

## Read first

1. `.adw/scenarios.md`. Use these sections, or their defaults when a section or the file is missing:

   | Section | Default |
   |---|---|
   | `## Scenario Directory` | `features/` |
   | `## Per-Issue Scenario Directory` | the Scenario Directory |
   | `## Regression Scenario Directory` | none |
   | `## Vocabulary Registry` | none |
   | `## Step Def Directory` | `features/steps` |
   | `## DSL Directory` | `features/support/dsl/` |
   | `## Driver Directory` | `features/support/drivers/` |

   Without a regression directory, every scenario counts as per-issue and the vocabulary rule does not apply.
2. `.adw/project.md`: `## Application Type` picks the runner. `web` uses [runner-playwright-bdd.md](runner-playwright-bdd.md). Anything else, or a missing section, uses the runner `## BDD Framework` names, written as in [runner-cucumber.md](runner-cucumber.md).
3. `.adw/coding_guidelines.md`, or `guidelines/coding_guidelines.md` in older repos: the steps, DSL and drivers must comply.
4. The runner's configuration (`cucumber.js`, `cucumber.json`, ...): which files it loads.
5. `README.md`, `UBIQUITOUS_LANGUAGE.md` if it exists, and the `app_docs/` documents that concern this issue.
6. The vocabulary registry, if one is set.
7. Every `.feature` file, step definition, DSL module and driver under the scenario directory.
8. [layers.md](layers.md) and your runner's file.

A guard limits what you can read, write and run. A blocked call's reason says what is allowed.

## Rules

- **Behaviour, not source.** A scenario asserts what the system does, never what its source looks like. These shapes are prohibited:
  - checking that a source file exists;
  - matching a substring of a source file's contents;
  - parsing a source file (as JSON, an AST, ...) and asserting on its structure.

  A scenario may assert on what the system produces: state files it writes, calls recorded on a mock server, exit codes, stdout and stderr, and git artefacts.
- **Domain language only.** Gherkin names no selectors, CSS classes, element ids, URLs, file paths, functions or modules. Name a UI interaction (click, hover, tap, a key) only when replacing it with another interaction would break the issue, as in "hovering reveals the explanation, clicking does not pin it". Otherwise say what the user achieves: "the user submits the form", not "the user clicks Submit". Use the terms in `UBIQUITOUS_LANGUAGE.md` and the phrases in the vocabulary registry. When the glossary has no term for a concept the issue needs, coin one and report it in `newTerms`.
- **The `Driver` describes what the test needs, not how the app is built.** A driver method performs an action or returns an observation of the system's output. It never returns source-file contents and never checks whether a file exists.
- **Assertions and expected values live only in steps and the DSL.** Drivers never assert.
- **Scope.** Write one scenario per observable behaviour the issue asks for. Add error and edge cases only when the issue states or clearly implies them. Use `Scenario Outline` for data variations. Write no speculative coverage.
- If the issue describes no observable behaviour, or contradicts itself, write nothing and report `failed` with the reason.
- **Regression.** Never add `@regression`, and never move a scenario into the regression directory. Regression files carry no tags. A regression scenario you edit may use only registered phrases. If it needs a new phrase, add the phrase to the registry first (see **Registering a phrase**).
- Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.

## Steps

1. **Resume.** Run `git status -- features/` and `git diff -- features/`. Uncommitted changes under `features/` are your own earlier work on this issue. Continue it; do not redo it.
2. **List the behaviours.** Take them from the issue body, its title and the actionable comments.
3. **Map them onto the existing scenarios.** For each behaviour, decide whether it needs a new scenario, an edit to an existing one, or nothing. Existing scenarios that this issue changes or makes obsolete may be edited or deleted, wherever they are under `features/`. Record every such change for the report.
4. **Write the Gherkin.** New scenarios go in `<Per-Issue Scenario Directory>/feature-{issueNumber}.feature`, with `@adw-{issueNumber}` once, on the line above `Feature:`. Edited scenarios stay in their own files.
5. **Write the steps, DSL and drivers**, following [layers.md](layers.md) and your runner's file:
   - Reuse existing step patterns and DSL verbs before adding new ones. Never register a step pattern that any step file the runner loads already registers.
   - Group step files and DSL modules by domain area, not by issue.
   - Give each domain area its own `<Area>Driver` interface. For each new method, add it to the interface, and add a `throw new NotImplemented("<Area>Driver.<method>")` body to the stub and to every other class that implements the interface.
6. **Report** (see **Output**).

## Registering a phrase

Add a row to the registry's phrase table with the phrase and its meaning. Write `TBD (driver)` in the `Pattern` and `Assertion target` columns; the drivers skill fills them in. List the phrase in `vocabularyAdded`.

## Alignment findings

If `alignmentFindings` is present, an earlier run already wrote the scenarios. Change only what each finding names, plus the step, DSL and driver changes that follow from it. Rewrite nothing else. Report the full result as in a first run.

## Output

Finish by calling the `report_scenarios` tool exactly once, after the last file is written. Its schema defines the report. Do not write the report as text.

- `scenarios`: every scenario implement-tdd must satisfy for this issue. That means the new ones and every one you edited, including regression scenarios. Leave out deleted ones.
- `changes`: every scenario that existed before this run and that you edited, added to an existing file, or deleted. Give the full Gherkin `before` and `after`. Use `null` for a scenario added to an existing file (`before`) or deleted (`after`).
- `newTerms`: the domain terms you coined because `UBIQUITOUS_LANGUAGE.md` has none for the concept. Not step phrases: unregistered phrases are found by code at promotion.
- `vocabularyAdded`: phrases you registered.
- `driverMethods`: the stub methods you added, as `<Area>Driver.<method>`.
- `failed`: set only when you wrote nothing, with the reason.

If the tool rejects the report, fix what the error names and call it again.
