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
packages/flow-import     TypeScript AST importer and config reader
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
  "root": {
    "steps": [
      { "id": "s1", "kind": "navigate", "url": { "source": "literal", "value": "/login" } },
      {
        "id": "s2",
        "kind": "condition",
        "predicate": {
          "type": "locatorVisible",
          "target": {
            "base": { "by": "testId", "value": { "source": "literal", "value": "toast" } }
          }
        },
        "then": { "steps": [] }
      }
    ]
  },
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

## Data-driven flows

A flow can carry a data table. Each row becomes its own named test, so a
failure names the case that failed rather than a row index inside one test:

```ts
const cases = [
  { name: 'valid user', email: 'qa@example.com', expected: 'Dashboard' },
  { name: 'blocked user', email: 'blocked@example.com', expected: 'Suspended' },
];

for (const { name, email, expected } of cases) {
  test('Login path' + ' — ' + name, async ({ page }) => {
    /* ... */
  });
}
```

Columns are in scope as variables inside the test and out of scope outside it.
Bind a step to one with the value source control in the inspector.

## Snippets

Snippets are reusable blocks with typed inputs and outputs, not opaque code
blobs. A snippet declares its parameters with types and optional defaults, and
declares what it returns. A `useSnippet` step binds arguments — literals, data
columns, or environment values — and captures outputs into named variables that
later steps can read.

The compiler inlines the body inside a block scope, so snippet locals cannot
leak into the flow, and reports a missing snippet, a missing required argument,
or an output the snippet does not declare.

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

| Command                      | What it does                                               |
| ---------------------------- | ---------------------------------------------------------- |
| `npm run dev`                | Studio with the file API and Vite                          |
| `npm run build`              | Build packages, typecheck, bundle                          |
| `npm test`                   | Unit tests for the compiler, migration, commands, importer |
| `npm run test:ui`            | End-to-end tests against the real server                   |
| `npm run migrate -- --write` | Migrate v1 flow files to v2                                |

## Migrating from v1

`npm run migrate` reports what will change before touching anything.

Condition and loop blocks migrate with **empty bodies and a blocking
diagnostic**. In v1 those blocks could not express nesting, so their branches
never executed — the generated spec contained a placeholder comment. Rebuilding
them in the editor is deliberate: regenerating that comment would preserve a
test that silently checked nothing.

## Workspace configuration

Studio reads your `playwright.config.ts` with the TypeScript AST and uses what
it finds: `baseURL` shortens navigation steps to paths, `testIdAttribute` and
`projects` are surfaced in the explorer, and generated specs import `test` and
`expect` from the fixture module named in `project.json`. A config it cannot
parse statically is reported rather than guessed at.

## Status

Working: the compiler and both profiles, nested control flow, data-driven
flows, typed snippets, the subprocess runner with traces and live step
streaming, run history with retention, cancellation, v1 migration, spec import,
config discovery, and the local security model.

Not built yet: reading data rows from an external CSV or JSON file rather than
the in-app table, running a flow against a chosen Playwright project from the
UI, and a visual diff for the generated spec before saving.
