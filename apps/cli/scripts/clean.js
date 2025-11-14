import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'dist');

try {
  await rm(target, { recursive: true, force: true });
} catch (error) {
  console.error('Failed to clean dist directory', error);
  process.exitCode = 1;
}
