import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const target = path.join(ROOT, ".next");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rmRecursive(p) {
  await fs.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(target))) return;

  // Try a few rounds to handle transient file locks on Windows.
  for (let i = 0; i < 4; i++) {
    try {
      await rmRecursive(target);
    } catch {
      // ignore and retry
    }

    if (!(await exists(target))) return;
    await sleep(250);
  }

  // Final check
  if (await exists(target)) {
    throw new Error("Failed to remove .next directory (file lock?). Stop Next dev server and try again.");
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
