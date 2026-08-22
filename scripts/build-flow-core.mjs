import { build } from 'esbuild';

await build({
  entryPoints: ['packages/flow-core/src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: 'packages/flow-core/dist/index.mjs',
  logLevel: 'error',
});

console.log('flow-core built');
