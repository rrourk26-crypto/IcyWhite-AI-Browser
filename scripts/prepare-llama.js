/* Run before packaging:  node scripts/prepare-llama.js
 * Collects llama-server(.exe) and every .dll / .so it needs into ./llama so electron-builder can ship them
 * as real files (they cannot live inside app.asar). Looks in ./llama, the app folder itself, and
 * "./llama.cpp-GPU-NVIDIA CUDA" (a nested copy). Fails with a clear message if llama-server is missing.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const dest = path.join(root, "llama");
const sources = [dest, root, path.join(root, "llama.cpp-GPU-NVIDIA CUDA"), path.join(root, "llama.cpp-GPU-NVIDIA CUDA", "llama.cpp-GPU-NVIDIA CUDA")];
const wanted = (n) => /^llama-server(\.exe)?$/i.test(n) || /\.(dll|so)$/i.test(n);

fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const dir of sources) {
  let names = []; try { names = fs.readdirSync(dir); } catch (e) { continue; }
  for (const n of names) {
    const from = path.join(dir, n);
    if (!wanted(n) || !fs.statSync(from).isFile() || dir === dest) continue;
    const to = path.join(dest, n);
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    fs.copyFileSync(from, to); copied++;
  }
}
const have = fs.readdirSync(dest);
// Runtime folders (./runtimes/<name>/llama-server.exe) are shipped as they are, so one of those is enough too.
function hasRuntime(dir, depth) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return false; }
  if (ents.some((e) => e.isFile() && /^llama-server(\.exe)?$/i.test(e.name))) return true;
  return depth > 0 && ents.some((e) => e.isDirectory() && !/^models?$/i.test(e.name) && hasRuntime(path.join(dir, e.name), depth - 1));
}
const runtimes = hasRuntime(path.join(root, "runtimes"), 3);
if (runtimes) console.log("runtime folders found in ./runtimes - they will be shipped with the app.");
if (!runtimes && !have.some((n) => /^llama-server(\.exe)?$/i.test(n))) {
  console.error("\nllama-server.exe was not found.\nPut each llama.cpp build (llama-server.exe and ALL its .dll files) in its own folder inside:\n  " + path.join(root, "runtimes") + "\n(or copy them flat into " + dest + ") and run this again.\n");
  process.exit(1);
}
console.log("llama files ready in ./llama (" + have.length + " files, " + copied + " newly copied).");
