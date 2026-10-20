# Pi Dev Workflow

A Node.js + TypeScript project (ESM) scaffolded with **Vitest** for unit tests
and **Cucumber** for BDD.

## Requirements

- Node.js >= 20

## Setup

```bash
npm install
```

## Scripts

| Command              | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Run `src/index.ts` in watch mode (via `tsx`)         |
| `npm run build`      | Compile TypeScript to `dist/`                        |
| `npm start`          | Run the compiled app (`dist/index.js`)               |
| `npm run typecheck`  | Type-check without emitting                          |
| `npm test`           | Run Vitest unit tests once                           |
| `npm run test:watch` | Run Vitest in watch mode                             |
| `npm run test:bdd`   | Run Cucumber BDD scenarios                           |
| `npm run test:all`   | Run unit tests then BDD scenarios                    |

## Layout

```
src/                  Application + library code
  index.ts            Entry point
  calculator.ts       Example module
  calculator.test.ts  Vitest unit tests (co-located)
features/             Cucumber BDD
  *.feature           Gherkin scenarios
  steps/              Step definitions
  support/            World / hooks
```

Unit tests are co-located with source as `*.test.ts`. BDD step definitions are
written in TypeScript and executed directly via `tsx` (no build step needed).

Replace the `Calculator` example with your real code.
