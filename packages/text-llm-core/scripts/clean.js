const { rm } = require('node:fs/promises');
const { resolve } = require('node:path');

const target = resolve(process.cwd(), 'dist');

rm(target, { recursive: true, force: true }).catch((error) => {
  console.error('Failed to clean dist directory', error);
  process.exitCode = 1;
});
