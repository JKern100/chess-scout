import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "node_modules", "stockfish", "src");
const OUT_DIR = path.join(ROOT, "public", "stockfish");

async function findFirst(prefix, suffix) {
  const entries = await fs.readdir(SRC_DIR);
  const match = entries.find((f) => f.startsWith(prefix) && f.endsWith(suffix));
  return match ? path.join(SRC_DIR, match) : null;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const js = await findFirst("stockfish-17.1-lite-single-", ".js");
  const wasm = await findFirst("stockfish-17.1-lite-single-", ".wasm");

  if (!js) {
    throw new Error(`Could not find Stockfish lite-single JS in ${SRC_DIR}`);
  }
  if (!wasm) {
    throw new Error(`Could not find Stockfish lite-single WASM in ${SRC_DIR}`);
  }

  const jsName = path.basename(js);
  const wasmName = path.basename(wasm);

  const outJs = path.join(OUT_DIR, "engine.js");
  const outWasm = path.join(OUT_DIR, "engine.wasm");

  const outJsOriginal = path.join(OUT_DIR, jsName);
  const outWasmOriginal = path.join(OUT_DIR, wasmName);

  await fs.copyFile(js, outJs);
  await fs.copyFile(wasm, outWasm);

  await fs.copyFile(js, outJsOriginal);
  await fs.copyFile(wasm, outWasmOriginal);

  // eslint-disable-next-line no-console
  console.log(
    `Copied Stockfish assets to public/stockfish as engine.js/engine.wasm and original names (from ${jsName}, ${wasmName})`
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
