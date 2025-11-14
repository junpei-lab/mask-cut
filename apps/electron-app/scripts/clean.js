const { readdir, rm } = require('node:fs/promises');
const { resolve } = require('node:path');

const target = resolve(process.cwd(), 'dist');
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 200;
const RETRIABLE_ERROR_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
const PACKAGED_APP_DIR = 'win-unpacked';

async function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function looksLikePackagedAppLock(error) {
  if (!error || typeof error.path !== 'string' || error.code !== 'EBUSY') {
    return false;
  }

  const normalized = error.path.replace(/\\/g, '/');
  return normalized.includes(`/dist/${PACKAGED_APP_DIR}`);
}

async function cleanDistContentsExcludingPackagedApp() {
  try {
    const entries = await readdir(target, { withFileTypes: true });
    const deletableEntries = entries.filter(
      (entry) => entry.name !== PACKAGED_APP_DIR
    );

    await Promise.all(
      deletableEntries.map((entry) =>
        rm(resolve(target, entry.name), { recursive: true, force: true })
      )
    );

    if (deletableEntries.length > 0) {
      console.warn(
        `Skipped ${PACKAGED_APP_DIR} because it appears to be in use, but removed other build outputs.`
      );
    } else {
      console.warn(
        `Only ${PACKAGED_APP_DIR} exists in dist; close the packaged app if you need it removed as well.`
      );
    }

    return true;
  } catch (innerError) {
    console.error('Failed to partially clean dist directory', innerError);
    return false;
  }
}

async function cleanDist(attempt = 1) {
  try {
    await rm(target, { recursive: true, force: true });
    return;
  } catch (error) {
    if (RETRIABLE_ERROR_CODES.has(error.code) && attempt < MAX_RETRIES) {
      const backoff = RETRY_DELAY_MS * attempt;
      console.warn(
        `Clean attempt ${attempt} failed with ${error.code}; retrying in ${backoff}ms...`
      );
      await delay(backoff);
      await cleanDist(attempt + 1);
      return;
    }

    if (looksLikePackagedAppLock(error)) {
      console.warn(
        `Unable to delete dist/${PACKAGED_APP_DIR} because files are locked (likely a running packaged app).`
      );
      const partialSuccess = await cleanDistContentsExcludingPackagedApp();
      if (partialSuccess) {
        return;
      }
    }

    console.error('Failed to clean dist directory', error);
    process.exitCode = 1;
  }
}

cleanDist();
