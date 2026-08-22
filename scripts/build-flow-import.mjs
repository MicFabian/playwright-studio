import { build } from 'esbuild';

await build({
  entryPoints: ['packages/flow-import/src/import-spec.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: 'packages/flow-import/dist/index.mjs',
  external: ['ts-morph'],
  logLevel: 'error',
});

console.log('flow-import built');
