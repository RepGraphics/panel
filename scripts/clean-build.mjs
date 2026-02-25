import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const targets = ['.output', '.nuxt', '.nitro', '.cache', 'node_modules/.cache/nuxt'];
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function removeTarget(path) {
  const absolutePath = resolve(root, path);
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(absolutePath, { recursive: true, force: true });
      return true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (!RETRYABLE_CODES.has(String(code))) {
        throw error;
      }

      lastError = error;
      await sleep(attempt * 250);
    }
  }

  const code =
    lastError && typeof lastError === 'object' && 'code' in lastError ? String(lastError.code) : 'UNKNOWN';
  console.warn(`[clean-build] Skipping locked path (${code}): ${path}`);
  return false;
}

const results = await Promise.all(targets.map(removeTarget));
const removed = targets.filter((_, index) => results[index]);
const skipped = targets.filter((_, index) => !results[index]);

if (removed.length) {
  console.log(`[clean-build] Removed: ${removed.join(', ')}`);
}

if (skipped.length) {
  console.warn(`[clean-build] Skipped: ${skipped.join(', ')}`);
}
