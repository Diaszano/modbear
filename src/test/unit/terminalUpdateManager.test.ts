import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  buildGoGetSuggestion,
  TerminalUpdateManager,
  type TerminalCreationOptions,
  type TerminalHandle
} from "../../providers/terminalUpdateManager";

class FakeTerminal implements TerminalHandle {
  public readonly sent: Array<{ text: string; shouldExecute: boolean | undefined }> = [];
  public showCalls = 0;

  public show(): void {
    this.showCalls += 1;
  }

  public sendText(text: string, shouldExecute?: boolean): void {
    this.sent.push({ text, shouldExecute });
  }
}

const validInput = {
  moduleRoot: path.resolve("/workspace/app"),
  modulePath: "github.com/gin-gonic/gin",
  version: "v1.10.1"
};

function createModuleRoot(t: TestContext): string {
  const moduleRoot = mkdtempSync(path.join(os.tmpdir(), "modbear-terminal-update-"));
  writeFileSync(path.join(moduleRoot, "go.mod"), "module example.com/test\n");
  t.after(() => rmSync(moduleRoot, { recursive: true, force: true }));
  return moduleRoot;
}

test("builds the exact go get suggestion", () => {
  assert.equal(
    buildGoGetSuggestion(validInput),
    "go get github.com/gin-gonic/gin@v1.10.1"
  );
});

test("rejects unsafe module paths and versions", () => {
  assert.throws(
    () => buildGoGetSuggestion({ ...validInput, modulePath: "example.com/mod;echo" }),
    /module path/
  );
  assert.throws(
    () => buildGoGetSuggestion({ ...validInput, version: "v1.2.3\nwhoami" }),
    /version/
  );
});

test("creates a module-rooted terminal and fills without executing", (t) => {
  const input = { ...validInput, moduleRoot: createModuleRoot(t) };
  const created: TerminalCreationOptions[] = [];
  const terminal = new FakeTerminal();
  const manager = new TerminalUpdateManager((options) => {
    created.push(options);
    return terminal;
  });

  manager.prepare(input);

  assert.deepEqual(created, [{ name: "ModBear", cwd: input.moduleRoot }]);
  assert.equal(terminal.showCalls, 1);
  assert.deepEqual(terminal.sent, [{
    text: "go get github.com/gin-gonic/gin@v1.10.1",
    shouldExecute: false
  }]);
});

test("reuses a live terminal for the same module root", (t) => {
  const input = { ...validInput, moduleRoot: createModuleRoot(t) };
  const terminals = [new FakeTerminal(), new FakeTerminal()];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  manager.prepare(input);
  manager.prepare({ ...input, version: "v1.11.0" });

  assert.equal(creations, 1);
  assert.equal(terminals[0]!.sent.length, 2);
});

test("forgets a closed terminal before the next preparation", (t) => {
  const input = { ...validInput, moduleRoot: createModuleRoot(t) };
  const terminals = [new FakeTerminal(), new FakeTerminal()];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  manager.prepare(input);
  manager.forget(terminals[0]!);
  manager.prepare(input);

  assert.equal(creations, 2);
  assert.equal(terminals[1]!.sent.length, 1);
});

test("rejects unavailable module roots before creating a terminal", (t) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "modbear-terminal-unavailable-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  let creations = 0;
  const manager = new TerminalUpdateManager(() => {
    creations += 1;
    return new FakeTerminal();
  });

  assert.throws(
    () => manager.prepare({ ...validInput, moduleRoot: path.join(parent, "missing") }),
    /module root.*directory/i
  );
  assert.equal(creations, 0);

  assert.throws(
    () => manager.prepare({ ...validInput, moduleRoot: parent }),
    /go\.mod.*regular file/i
  );
  assert.equal(creations, 0);

  mkdirSync(path.join(parent, "go.mod"));
  assert.throws(
    () => manager.prepare({ ...validInput, moduleRoot: parent }),
    /go\.mod.*regular file/i
  );
  assert.equal(creations, 0);
});

test("creates a fresh terminal after an interaction failure", (t) => {
  const input = { ...validInput, moduleRoot: createModuleRoot(t) };
  const firstTerminal: TerminalHandle = {
    show: () => undefined,
    sendText: () => {
      throw new Error("terminal interaction failed");
    }
  };
  const secondTerminal = new FakeTerminal();
  const terminals = [firstTerminal, secondTerminal];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  assert.throws(() => manager.prepare(input), /terminal interaction failed/);
  manager.prepare(input);

  assert.equal(creations, 2);
  assert.equal(secondTerminal.sent.length, 1);
});
