# Playwright Low-Code Studio

An MVP foundation for an IDE-style, low-code Playwright test manager.

## Product direction

The app is structured around three core ideas:

- A visual flow editor where tests are assembled from Playwright-aligned blocks.
- A snippet system for reusable custom logic that still lives inside the product.
- A code preview that keeps the visual model grounded in real Playwright specs.

## What is implemented

- IDE shell with workspace tree, block library, canvas, and inspector.
- Draggable flow nodes powered by React Flow.
- Block model for navigation, actions, assertions, logic, and reusable snippets.
- Editable block properties and persisted snippet files.
- Quick snippet insertion from flow creation UI.
- Generated Playwright spec preview based on the current graph order.
- Git status plus init, stage, and commit actions in the UI.
- Built-in run engine with per-step status, per-step screenshots, and live/headless mode.

## File-backed workspace

The source of truth now lives on disk, not in a database.

```text
playwright-lowcode/
  project.json
  tests/
    *.flow.json
  snippets/
    *.snippet.json
tests/
  generated/
    *.spec.ts
```

- `playwright-lowcode/tests/*.flow.json` stores the visual graph for each test.
- `playwright-lowcode/snippets/*.snippet.json` stores reusable snippets.
- `tests/generated/*.spec.ts` is generated from the saved graph and meant to be tracked in Git.

## Git model

- The filesystem is intended to be the project database.
- Git is the history, collaboration, and rollback mechanism.
- The app reads Git status and surfaces whether the workspace is clean or dirty.
- Saving a flow writes JSON and regenerates its Playwright spec, so the diff is reviewable.
- Snippets are editable as first-class files, and Git actions operate on the workspace files the tool owns.

## Next build steps

1. Add nested branch semantics for `condition` and `loop`.
2. Introduce a real snippet editor with inputs, outputs, and validation.
3. Add a backend runner that executes generated specs locally.
4. Attach Playwright artifacts like traces, screenshots, and videos to each run.
5. Add import/export from existing handwritten Playwright specs.

## Run

Once `node` and `npm` are installed:

```bash
nvm use
npm install
npx playwright install chromium
npm run dev
```

`npm run dev` starts the local file API and the Vite app on the same server.

If Chromium is missing, run startup will fail until `npx playwright install chromium` completes.

## UI Tests

Run browser-level UI regression tests:

```bash
npm run test:ui
```

For local debugging with a visible browser:

```bash
npm run test:ui:headed
```
