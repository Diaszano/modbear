#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFileSync, writeSync } from "node:fs";

const [command, value] = process.argv.slice(2);
if (command === "echo") writeSync(process.stdout.fd, `${value}\n`);
if (command === "sleep") await new Promise((resolve) => setTimeout(resolve, Number(value)));
if (command === "spawn-grandchild") {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], { stdio: "ignore" });
  writeFileSync(value, String(grandchild.pid));
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (command === "fail" || command === "list") {
  writeSync(process.stderr.fd, "proxy https://user:password@example.test failed\n");
  process.exit(7);
}
