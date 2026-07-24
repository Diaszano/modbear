#!/usr/bin/env node

const [command, value] = process.argv.slice(2);
if (command === "echo") process.stdout.write(`${value}\n`);
if (command === "sleep") await new Promise((resolve) => setTimeout(resolve, Number(value)));
if (command === "fail" || command === "list") {
  process.stderr.write("proxy https://user:password@example.test failed\n");
  process.exit(7);
}
