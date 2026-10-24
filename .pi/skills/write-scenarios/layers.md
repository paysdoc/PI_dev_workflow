# The four layers

Each layer talks only to the one below it. Paths below use the default directories; use the configured ones from `.adw/scenarios.md` where they differ. The example is TypeScript; write in the language your runner's file says.

| Layer | Lives in | Says | May contain | Never contains |
|---|---|---|---|---|
| Gherkin | `.feature` files | *what* the user or caller needs, in domain language | Given/When/Then steps, `Scenario Outline` examples | selectors, URLs, file paths, function names, UI mechanics |
| Steps | Step Def Directory | which DSL verb a phrase means | one DSL call per step, the step's parameters | logic, assertions written inline, driver calls |
| DSL | DSL Directory | the domain verbs and the expected outcomes | assertions, expected values, sequencing of driver calls | I/O, knowledge of how the app is reached |
| Drivers | Driver Directory | *how* to act on the system and observe it | one interface per domain area, stub classes, the factory | assertions, expected values, constants taken from a scenario |

The `Driver` interface is shaped by what the DSL needs, not by the app's modules. The app never implements it; a later skill writes real drivers that reach the app. Until then, every method of a stub throws `NotImplemented`, so the scenarios fail clearly at the first unimplemented step.

## Worked example

A CLI task list. The issue: "Completing a task moves it from the open list to the completed list."

`features/per-issue/feature-42.feature`

```gherkin
@adw-42
Feature: Completing tasks

  Scenario: A completed task leaves the open list
    Given an open task "Buy milk"
    When the user completes "Buy milk"
    Then the open tasks do not include "Buy milk"
    And the completed tasks include "Buy milk"
```

`features/steps/tasks.steps.ts` (registration follows your runner's file)

```ts
Given("an open task {string}", async function (this: ScenarioWorld, title: string) {
  await this.dsl.tasks.haveOpenTask(title);
});

When("the user completes {string}", async function (this: ScenarioWorld, title: string) {
  await this.dsl.tasks.complete(title);
});

Then("the open tasks do not include {string}", async function (this: ScenarioWorld, title: string) {
  await this.dsl.tasks.expectNotOpen(title);
});

Then("the completed tasks include {string}", async function (this: ScenarioWorld, title: string) {
  await this.dsl.tasks.expectCompleted(title);
});
```

`features/support/dsl/tasks.ts`

```ts
import assert from "node:assert/strict";
import type { TasksDriver } from "../drivers/tasksDriver";

export class TasksDsl {
  constructor(private readonly driver: TasksDriver) {}

  async haveOpenTask(title: string): Promise<void> {
    const result = await this.driver.addTask(title);
    assert.equal(result.exitCode, 0, `adding "${title}" failed: ${result.stderr}`);
  }

  async complete(title: string): Promise<void> {
    const result = await this.driver.completeTask(title);
    assert.equal(result.exitCode, 0, `completing "${title}" failed: ${result.stderr}`);
  }

  async expectNotOpen(title: string): Promise<void> {
    assert.ok(!(await this.driver.listTasks("open")).includes(title), `"${title}" is still open`);
  }

  async expectCompleted(title: string): Promise<void> {
    assert.ok((await this.driver.listTasks("completed")).includes(title), `"${title}" is not completed`);
  }
}
```

`features/support/dsl/index.ts`

```ts
import type { Drivers } from "../drivers";
import { TasksDsl } from "./tasks";

export interface Dsl {
  readonly tasks: TasksDsl;
}

export const createDsl = (drivers: Drivers): Dsl => ({ tasks: new TasksDsl(drivers.tasks) });
```

`features/support/drivers/tasksDriver.ts`

```ts
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface TasksDriver {
  addTask(title: string): Promise<CommandResult>;
  completeTask(title: string): Promise<CommandResult>;
  listTasks(state: "open" | "completed"): Promise<readonly string[]>;
}
```

`features/support/drivers/stub/tasksDriver.ts`

```ts
import { NotImplemented } from "../notImplemented";
import type { CommandResult, TasksDriver } from "../tasksDriver";

export class StubTasksDriver implements TasksDriver {
  addTask(): Promise<CommandResult> {
    throw new NotImplemented("TasksDriver.addTask");
  }

  completeTask(): Promise<CommandResult> {
    throw new NotImplemented("TasksDriver.completeTask");
  }

  listTasks(): Promise<readonly string[]> {
    throw new NotImplemented("TasksDriver.listTasks");
  }
}
```

`features/support/drivers/notImplemented.ts` (create it once, if missing)

```ts
export class NotImplemented extends Error {
  constructor(method: string) {
    super(`Driver method not implemented yet: ${method}`);
    this.name = "NotImplemented";
  }
}
```

`features/support/drivers/index.ts`: the one place that chooses the drivers. The drivers skill later swaps the stubs for real drivers here.

```ts
import { StubTasksDriver } from "./stub/tasksDriver";
import type { TasksDriver } from "./tasksDriver";

export interface Drivers {
  readonly tasks: TasksDriver;
}

export const createDrivers = (): Drivers => ({ tasks: new StubTasksDriver() });
```

This example reports `driverMethods: ["TasksDriver.addTask", "TasksDriver.completeTask", "TasksDriver.listTasks"]`.

## Growing an area

- **A new verb in an existing area.** Add the method to the area's DSL class. If the DSL needs a new observation or action, add the method to the `Driver` interface, a `NotImplemented` body to the stub, and a `NotImplemented` body to every other class that implements the interface, real drivers included. That keeps the type check green until the drivers skill fills them in.
- **A new area.** Add `<area>Driver.ts`, `stub/<area>Driver.ts` and `dsl/<area>.ts`. Wire the area into `Drivers`, `createDrivers` and `Dsl`.
- **Keep files under about 300 lines.** When an area outgrows that, split it into two areas with clear names, not into numbered parts.
