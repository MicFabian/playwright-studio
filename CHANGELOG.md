# Changelog

Notable changes to Playwright Studio. Dates are release dates.

## Unreleased

### Added

- Desktop app. Electron shell with native menus, a folder picker for choosing
  the project, remembered window bounds, and installers for macOS, Windows, and
  Linux.
- Data-driven flows. A flow can carry a table of cases; each row compiles to its
  own named test, so a failure names the case that failed.
- Typed snippets. Snippets declare typed inputs with defaults and typed outputs,
  and a `useSnippet` step binds arguments and captures results into variables
  later steps can read.
- Spec import. Existing Playwright specs are parsed with the TypeScript AST and
  turned into flows, reporting per-test fidelity and keeping anything unmappable
  as custom code with the original source.
- Workspace config discovery. `playwright.config.ts` is read for `baseURL`,
  `testIdAttribute`, projects, and web server, and generated specs follow it.
- Command palette, drag to reorder steps, and keyboard shortcuts for save, undo,
  redo, run, and delete.
- Autosave, plus a prompt when closing with unsaved work.

### Changed

- One compiler. The editor, the saved spec, and the run all compile from the same
  IR; the previous second implementation in the server is gone.
- Runs execute the generated spec as a `playwright test` subprocess and stream
  per-step results, replacing the in-process interpreter.
- Flow files use format version 2: a nested document with real `condition`,
  `loop`, and `try` bodies, and no presentation data.
- Generated code prefers `getByRole`, `getByTestId`, and `getByLabel` over raw
  CSS, and wraps each step in `test.step` so traces carry structure.

### Fixed

- Generated specs could not run at all: the workspace depended on `playwright`
  while every generated spec imports `@playwright/test`.
- A variable extracted inside a branch or loop was declared inside that block, so
  later steps reading it threw at runtime with no compiler error.
- Runs were unbounded: repeated clicks spawned one browser per click.
- A single unreadable flow file made the whole workspace fail to load.
- A workspace refresh could discard unsaved edits.
- Malformed cookies returned 500 from every authenticated endpoint, and a
  malformed `Last-Event-ID` silently delivered no run events.

### Security

- The local API binds loopback only, requires a session established from a
  single-use launch token, and checks CSRF and origin on every mutation.
- Runs execute persisted flows by id; arbitrary step payloads are rejected.
