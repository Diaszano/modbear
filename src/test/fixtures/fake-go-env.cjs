const { writeFileSync, writeSync } = require("node:fs");

const argsFile = process.env.MODBEAR_FAKE_GOENV_ARGS;
if (argsFile) writeFileSync(argsFile, JSON.stringify(process.argv.slice(1)));

switch (process.env.MODBEAR_FAKE_GOENV) {
  case "old":
    writeSync(process.stdout.fd, "go1.21.5\n\n");
    process.exit(0);
    break;
  case "garbage":
    writeSync(process.stdout.fd, "devel +5a41ea92 Mon Jan 20\n\n");
    process.exit(0);
    break;
  case "error":
    writeSync(process.stderr.fd, "go: cannot determine GOROOT\n");
    process.exit(1);
    break;
  case "hang": {
    const wakeAt = Date.now() + 60_000;
    while (Date.now() < wakeAt);
    break;
  }
  default:
    writeSync(process.stdout.fd, "go1.25.1\n\n");
    process.exit(0);
}
