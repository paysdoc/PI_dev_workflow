---
name: plan-issue
description: Writes an implementation plan for a GitHub issue classified as bug, chore or feature into specs/. Invoked by the ADW plan phase with labelled inputs; not for interactive use.
disable-model-invocation: true
---

# Plan an issue

You write a **plan**, not code. Your only output is one plan file.

## Inputs

Labelled values in the request. Use them by label, never by position.

- `type`: `bug`, `chore` or `feature`
- `issueNumber`: numeric issue number
- `adwId`: ADW workflow ID
- `issueJson`: the issue as JSON (`title`, `body`, `comments`, ...). This is the requirement.
- `unitTests`: `true` or `false`. When `false`, plan no test-writing tasks.

## Read first

1. `README.md`
2. `.adw/project.md`: project overview and file map. The map orients you; it does not limit where you look.
3. `.adw/coding_guidelines.md`: the plan must comply.
4. `.adw/commands.md`: source for `Validation Commands` and the library install command.
5. `.adw/conditional_docs.md`: read only the docs whose conditions match this issue, and list each one in `## Relevant Files`.
6. `templates/<type>.md` (next to this file): the plan format and the one rule specific to this type.

## Rules

- A guard limits what you can read, write and run. A blocked call's reason says what is allowed.
- Write exactly one file: `specs/issue-{issueNumber}-adw-{adwId}-sdlc_planner-{slug}.md`, where `{slug}` is a short kebab-case name for the issue.
- Leave BDD to the scenario writer. While you plan, another skill writes this issue's scenarios, step definitions and drivers under `features/`, and the implementer makes them pass. Plan no task that creates or changes anything under `features/`. Test-writing tasks are unit tests.
- Write the plan as soon as your research fills every section, then stop.

## Writing the plan

- Follow the template exactly. Replace every `<placeholder>`; keep every heading.
- `## Relevant Files` is the implementer's only view of the codebase. List the files the tasks need to read, including matched docs.
- The plan's write scope is enforced. The implementer can change only the files in `### Files to Change`, and create the files in `### New Files`. List every file the tasks change or create, including unit test files, snapshots and fixtures. Write `- none` for an empty section.
- Paths are exact and relative to the repository root: no globs, no directories, no `./`. Every path in `### Files to Change` must exist, and no path in `### New Files` may exist.
- End every task with two lines. `Files:` lists the backticked paths the task changes or creates, or `none`. `Tests:` lists the backticked unit test paths that cover it, or `none: <reason>`. Every path in these lines must appear in `### Files to Change` or `### New Files`, and every path there must appear in a task.
- Use `Tests: none: <reason>` only for tasks with no behaviour to test (configuration, validation), or when unit tests are off. When `unitTests` is `false`, every task says `Tests: none`.
- Record each new library under `### Dependencies` in `## Notes`, with the install command from `.adw/commands.md`. Write `- none` if there are none.
- Every command in `## Validation Commands` must be expected to pass after the change.
- Add a library only if needed.
- A plan check runs on every write to the plan. If the write comes back as an error, fix every problem it lists in the same file. Stop when the check says the attempts are used up.

## Finish

Reply with one line: the path of the plan file.
