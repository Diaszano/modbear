import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Logger } from "../../logging/logger";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
type LoggerConstructor = typeof Logger;

async function loadLogger(): Promise<LoggerConstructor> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    return request === "vscode"
      ? {
          window: {
            createOutputChannel: () => {
              throw new Error("Unexpected output channel creation");
            },
          },
        }
      : originalLoad.call(this, request, parent, isMain);
  };

  try {
    return (await import("../../logging/logger.js")).Logger;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

function createChannelDouble() {
  const messages = {
    debug: [] as string[],
    info: [] as string[],
    warn: [] as string[],
    error: [] as string[],
  };

  return {
    messages,
    channel: {
      debug: (message: string) => messages.debug.push(message),
      info: (message: string) => messages.info.push(message),
      warn: (message: string) => messages.warn.push(message),
      error: (message: string) => messages.error.push(message),
      show: () => undefined,
      dispose: () => undefined,
    },
  };
}

test("does not emit debug events when configured at info level", async () => {
  const output = createChannelDouble();
  const Logger = await loadLogger();
  const logger = new Logger(
    () => "info",
    () => output.channel,
  );

  logger.event("debug", "scan.command", { command: "go list" });

  assert.deepEqual(output.messages.debug, []);
});

test("emits exactly the configured logger threshold matrix", async () => {
  const Logger = await loadLogger();
  const levels = ["error", "warn", "info", "debug"] as const;

  for (const threshold of levels) {
    const output = createChannelDouble();
    const logger = new Logger(
      () => threshold,
      () => output.channel,
    );

    for (const level of levels) logger.event(level, `${threshold}.${level}`, {});

    for (const level of levels) {
      const expected = levels.indexOf(level) <= levels.indexOf(threshold) ? [`${threshold}.${level}`] : [];
      assert.deepEqual(
        output.messages[level],
        expected,
        `${threshold} should ${expected.length ? "emit" : "suppress"} ${level}`,
      );
    }
  }
});

test("emits error events with redacted fields", async () => {
  const output = createChannelDouble();
  const Logger = await loadLogger();
  const logger = new Logger(
    () => "info",
    () => output.channel,
  );

  logger.event("error", "scan.failed", {
    detail: "go list cwd=/home/alice/private https://user:password@example.com/private/module token=abc123",
  });

  assert.deepEqual(output.messages.error, [
    "scan.failed detail=go list cwd=[redacted-path] https://***@example.com/private/module token=***",
  ]);
});

test("emits scan lifecycle events correctly formatted and redacted", async () => {
  const output = createChannelDouble();
  const Logger = await loadLogger();
  const logger = new Logger(
    () => "info",
    () => output.channel,
  );

  logger.event("info", "scan.started", {
    kind: "updates",
    cache: "miss",
  });

  logger.event("info", "scan.finished", {
    outcome: "success",
    durationMs: 150,
    cache: "miss",
    dependencies: 12,
  });

  logger.event("info", "scan.failed", {
    kind: "exit-nonzero",
    durationMs: 250,
    exitCode: 7,
    stderr: "error reading directory",
  });

  const messages = output.messages.info;

  assert.match(messages[0]!, /^scan\.started kind=updates cache=(hit|miss)$/);
  assert.match(messages[1]!, /^scan\.finished outcome=success durationMs=\d+ cache=(hit|miss) dependencies=\d+$/);
  assert.match(messages[2]!, /^scan\.failed kind=exit-nonzero durationMs=\d+ exitCode=7 stderr=/);
  assert.doesNotMatch(messages.join("\\n"), /\/home\/|example\.com\/private|password/);
});
