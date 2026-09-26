import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, ".venv", "bin", "python");
const nextBin = path.join(root, "node_modules", ".bin", "next");

if (!existsSync(python)) {
  console.error("No .venv yet. Create it, then install the brain:");
  console.error("  python3.14 -m venv .venv");
  console.error("  .venv/bin/pip install -r sim/requirements.txt");
  process.exit(1);
}

if (!existsSync(nextBin)) {
  console.error("Next.js is not installed. Run npm install first.");
  process.exit(1);
}

const children = [];

function start(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  children.push(child);
  return child;
}

const sim = start(python, ["-u", "sim/server.py"]);
const web = start(nextBin, ["dev", "--port", "3000"]);

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

sim.on("exit", (code, signal) => {
  if (signal) return;
  console.error(`brain server exited (${code})`);
});

web.on("exit", (code, signal) => {
  if (signal) return;
  shutdown();
  process.exit(code ?? 0);
});
