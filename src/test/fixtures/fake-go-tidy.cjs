const { writeFileSync, writeSync } = require("node:fs");

const argsFile = process.env.MODBEAR_FAKE_TIDY_ARGS;
if (argsFile) writeFileSync(argsFile, JSON.stringify(process.argv.slice(1)));

switch (process.env.MODBEAR_FAKE_TIDY) {
  case "diff":
    writeSync(
      process.stdout.fd,
      "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1,3 +1,3 @@\n",
    );
    process.exit(1);
    break;
  case "error":
    writeSync(process.stderr.fd, "go: missing: no matching versions\n");
    process.exit(1);
    break;
  case "hang": {
    const wakeAt = Date.now() + 60_000;
    while (Date.now() < wakeAt);
    break;
  }
  default:
    process.exit(0);
}
