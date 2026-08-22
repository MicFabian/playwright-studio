# Playwright Studio

A low-code editor for Playwright tests. Flows are edited visually, stored as
JSON on disk, and compiled to real Playwright specs that you commit and run with
your own tooling.

## Why this exists

Visual test builders usually trap you: the recording is the source of truth, and
the code it emits is an export you cannot maintain. Studio inverts that. The
generated spec is the deliverable. It uses `getByRole`, `getByTestId`, and
`getByLabel`, wraps each block in `test.step()` so traces carry structure, and
imports `test` and `expect` from whatever fixture module your repository already
uses. If you delete Studio tomorrow, your tests keep working.

## Architecture

```text
packages/flow-core       IR, compiler, block registry, AST commands, migration
packages/flow-import     TypeScript AST importer for existing specs
packages/studio-runner   Subprocess runner and Playwright reporter
server.mjs               Local API: workspace, runs, git, import
src/                     React editor
```

One compiler serves the whole product. The editor previews with it, saving
writes its output, and runs execute the spec it produces. Two profiles exist:
`commit` writes the reviewable spec, and `studio-run` decorates the same
statements with step ids the reporter maps back to canvas blocks. A test asserts
both profiles emit identical `page` and `expect` calls, so what you run and what
you commit cannot drift apart.

Runs are subprocesses. Studio spawns `playwright test` against the generated
spec and streams per-step events from a custom reporter over a dedicated file
descriptor. Nothing is interpreted in the server process.

### Flow documents

A flow is a nested document, not a graph:

```json
{
  "formatVersion": 2,
  "name": "Login path",
  "root": { "steps": [
    { "id": "s1", "kind": "navigate", "url": { "source": "literal", "value": "/login" } },
    { "id": "s2", "kind": "condition",
      "predicate": { "type": "locatorVisible", "target": { "base": { "by": "testId", "value": { "source": "literal", "value": "toast" } } } },
      "then": { "steps": [] } }
  ]},
  "layout": { "positions": {} }
}
```

Array order is sequence and nesting is scope, so `condition`, `loop`, and `try`
have real bodies. Presentation lives in the block registry, never in the file, so
a saved flow holds semantics and layout only and its diffs stay readable.

The canvas is a projection of this document. Dragging and dropping issues AST
commands rather than mutating nodes, and moving a scope into its own descendant
is refused instead of producing a cycle the compiler cannot emit.

## Files on disk

```text
playwright-lowcode/
  project.json                 workspace paths and Playwright integration
  tests/*.flow.json            flow documents
  snippets/*.snippet.json      reusable snippets
  runs/<id>/                   manifest, events, spec, artifacts
tests/generated/*.spec.ts      generated specs, meant to be committed
```

Git is the history layer. Saving writes JSON and regenerates the spec, so every
change is reviewable in a diff.

## Importing existing specs

Studio parses real TypeScript rather than matching patterns. It reads the action
and assertion vocabulary, locator chains with `filter` and `nth`, `if`/`else`,
`for...of`, `try`/`catch`/`finally`, and variable extraction, and adopts
`test.step` titles as labels.

What it cannot map, it keeps. Unmappable statements become custom code steps
holding the original source with a diagnostic naming the line, and each test is
reported as `structured`, `mixed`, or `opaque`. Import previews the mapping
before writing anything, creates new flows, and never overwrites your file.

## Security

Studio executes repository code, so the local API is treated as a privileged
surface. It binds loopback only, every route requires a session established from
a single-use launch token printed at startup, mutations require a CSRF header and
an exact origin match, and runs execute persisted flows by id — arbitrary node
and step payloads are rejected. `--unsafe-network-listen` exists for deliberate
remote use and warns loudly.

Custom code blocks run as part of your test suite, with the same trust as any
other file in the repository.

## Run it

```bash
nvm use
npm install
npx playwright install chromium
npm run dev
```

Open the URL printed at startup — it carries the launch token.

| Command | What it does |
| --- | --- |
| `npm run dev` | Studio with the file API and Vite |
| `npm run build` | Build packages, typecheck, bundle |
| `npm test` | Unit tests for the compiler, migration, commands, importer |
| `npm run test:ui` | End-to-end tests against the real server |
| `npm run migrate -- --write` | Migrate v1 flow files to v2 |

## Migrating from v1

`npm run migrate` reports what will change before touching anything.

Condition and loop blocks migrate with **empty bodies and a blocking
diagnostic**. In v1 those blocks could not express nesting, so their branches
never executed — the generated spec contained a placeholder comment. Rebuilding
them in the editor is deliberate: regenerating that comment would preserve a
test that silently checked nothing.

## Status

Working: the compiler and both profiles, nested control flow, the subprocess
runner with traces and live step streaming, run history with retention,
cancellation, v1 migration, spec import, and the local security model.

Not built yet: data-driven runs from fixture tables, a snippet editor with typed
inputs and outputs, and a Playwright config reader that surfaces existing
projects and `baseURL` in the UI.
