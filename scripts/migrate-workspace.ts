import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileFlow, hasBlockingDiagnostics } from '../packages/flow-core/src/compiler';
import { isV1Flow, migrateV1Flow, type MigrationNote } from '../packages/flow-core/src/migrate-v1';

const rootDir = process.cwd();
const write = process.argv.includes('--write');
const testsDir = path.join(rootDir, 'playwright-lowcode', 'tests');

const colors = {
  reset: '[0m',
  red: '[31m',
  yellow: '[33m',
  green: '[32m',
  dim: '[2m',
};

function formatNote(note: MigrationNote): string {
  const color =
    note.severity === 'error'
      ? colors.red
      : note.severity === 'warning'
        ? colors.yellow
        : colors.dim;
  return `    ${color}${note.severity}${colors.reset} ${note.code}: ${note.message}`;
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, contents);
  await fs.rename(temporaryPath, filePath);
}

async function main(): Promise<void> {
  const entries = (await fs.readdir(testsDir)).filter((file) => file.endsWith('.flow.json'));
  let blocking = 0;
  let migrated = 0;
  let pending = 0;

  for (const entry of entries) {
    const filePath = path.join(testsDir, entry);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));

    if (!isV1Flow(raw)) {
      console.log(`${colors.dim}skip${colors.reset} ${entry} (already v2)`);
      continue;
    }

    pending += 1;
    const fallbackId = path.basename(entry, '.flow.json');
    const { document, notes } = migrateV1Flow(raw, fallbackId);
    const result = compileFlow(document);
    const blockedByCompiler = hasBlockingDiagnostics(result);
    const blockedByMigration = notes.some((note) => note.severity === 'error');

    if (blockedByCompiler || blockedByMigration) {
      blocking += 1;
      console.log(`${colors.red}BLOCKED${colors.reset} ${entry}`);
    } else {
      console.log(`${colors.green}ok${colors.reset}      ${entry}`);
    }

    notes.forEach((note) => console.log(formatNote(note)));
    result.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .forEach((diagnostic) =>
        console.log(
          `    ${colors.red}error${colors.reset} ${diagnostic.code}: ${diagnostic.message}`,
        ),
      );

    if (write) {
      await writeAtomic(filePath, `${JSON.stringify(document, null, 2)}\n`);
      migrated += 1;
    }
  }

  console.log('');

  if (write) {
    console.log(`Migrated ${migrated} flow file(s) to format version 2.`);
  } else if (pending === 0) {
    console.log('Nothing to migrate. Every flow file is already format version 2.');
  } else {
    console.log(`Dry run. Re-run with --write to migrate ${pending} file(s).`);
  }

  if (blocking > 0) {
    console.log(
      `${colors.red}${blocking} flow(s) need manual work${colors.reset} — condition and loop ` +
        'bodies could not be expressed in v1 and must be rebuilt in the editor.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
