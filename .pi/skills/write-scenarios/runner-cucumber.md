# Runner: cucumber-js (descriptor mode)

Use this when `## Application Type` is not `web`. The steps run on the runner that `## BDD Framework` names. This file gives the cucumber-js idiom. For another Gherkin framework, keep the same four layers and use that framework's registration, World or context object, file extension and assertion idiom.

## Language

Write every layer in the language the existing step definitions use, with their file extension and module style (for example ES modules in JavaScript). Use TypeScript only when there are no step definitions yet. The examples here and in [layers.md](layers.md) are TypeScript; drop the types for JavaScript.

## Registration

Step files are named `<area>.steps.<ext>` in the Step Def Directory, unless the existing step files follow another naming pattern; then follow that. Register steps with `Given`, `When` and `Then` from `@cucumber/cucumber`. Use `function` bodies, not arrow functions, so `this` is the World:

```ts
import { Given, Then, When } from "@cucumber/cucumber";
import type { ScenarioWorld } from "../support/world";

Given("an open task {string}", async function (this: ScenarioWorld, title: string) {
  await this.dsl.tasks.haveOpenTask(title);
});
```

Use Cucumber expressions (`{string}`, `{int}`, `{word}`) rather than regular expressions.

## World

The World gives every scenario a fresh DSL over fresh drivers. Create it once, in a file the runner loads: `features/support/world.<ext>` if the runner's configuration loads `features/support/`, otherwise `<Step Def Directory>/world.<ext>`. If the project already has a World, add `dsl` to it rather than registering a second one: cucumber-js allows only one `setWorldConstructor`.

```ts
import { type IWorldOptions, setWorldConstructor, World } from "@cucumber/cucumber";
import { createDrivers } from "./drivers";
import { createDsl, type Dsl } from "./dsl";

export class ScenarioWorld extends World {
  readonly dsl: Dsl;

  constructor(options: IWorldOptions) {
    super(options);
    this.dsl = createDsl(createDrivers());
  }
}

setWorldConstructor(ScenarioWorld);
```

## Assertions

Use `node:assert/strict` in the DSL, unless the existing DSL already uses another assertion library; then use that one.

## Runner configuration

Do not change the runner's configuration (`cucumber.json`, `cucumber.js`). Read it to see which files it loads. Only step files and the World must be loaded; the DSL and drivers are imported by them, so their directories need not be. If the runner does not load the Step Def Directory, report `failed` with that reason rather than writing steps that never load.
