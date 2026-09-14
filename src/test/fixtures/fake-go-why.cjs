const { writeFileSync, writeSync } = require("node:fs");

const argsFile = process.env.MODBEAR_FAKE_WHY_ARGS;
if (argsFile) writeFileSync(argsFile, JSON.stringify(process.argv.slice(1)));

switch (process.env.MODBEAR_FAKE_WHY) {
  case "error":
    writeSync(process.stderr.fd, "go: example.com/library: module is not required\n");
    process.exit(1);
    break;
  case "hang": {
    const wakeAt = Date.now() + 60_000;
    while (Date.now() < wakeAt);
    break;
  }
  default:
    writeSync(process.stdout.fd, "# example.com/fixture\nexample.com/fixture\nexample.com/library\n");
    process.exit(0);
}
