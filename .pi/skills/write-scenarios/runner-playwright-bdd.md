# Runner: playwright-bdd (web mode)

Use this when `## Application Type` is `web`. The scenarios run on the Playwright test runner through `playwright-bdd`, under a configuration ADW owns. Whatever `## BDD Framework` and `## Step Def Directory` say, and whatever language the application is written in:

- Step files are TypeScript files under `features/steps/`, which the configuration loads as `features/steps/**/*.ts`.
- Never edit `features/playwright.config.ts` or `features/.gitignore`. ADW owns them.

## Fixture and registration

A fixture gives every scenario a fresh DSL over fresh drivers. Create `features/steps/fixtures.ts` once and register steps through the `Given`, `When` and `Then` it exports:

```ts
import { createBdd, test as base } from "playwright-bdd";
import { createDrivers } from "../support/drivers";
import { createDsl, type Dsl } from "../support/dsl";

export const test = base.extend<{ dsl: Dsl }>({
  dsl: async ({ page }, use) => {
    await use(createDsl(createDrivers({ page })));
  },
});

export const { Given, When, Then } = createBdd(test);
```

```ts
import { Given } from "./fixtures";

Given("an open task {string}", async ({ dsl }, title: string) => {
  await dsl.tasks.haveOpenTask(title);
});
```

A step receives the fixtures as its first argument and the step's parameters after it. Use Cucumber expressions (`{string}`, `{int}`).

The `dsl` fixture takes `page`, so every scenario uses it. The configuration captures an end-state screenshot of every scenario that uses `page`, and that image is the review's visual evidence.

## Drivers in this mode

`createDrivers` takes what the real drivers will need, here `{ page }` (a `Page` from `@playwright/test`). The stubs ignore it. The `Driver` interfaces never expose `page`, selectors or URLs; those belong to the real drivers. Navigation, the base URL and the dev server are not your concern.

## Assertions

Use `expect` from `@playwright/test` in the DSL.
