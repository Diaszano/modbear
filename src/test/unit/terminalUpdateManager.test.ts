import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
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

test("creates a module-rooted terminal and fills without executing", () => {
  const created: TerminalCreationOptions[] = [];
  const terminal = new FakeTerminal();
  const manager = new TerminalUpdateManager((options) => {
    created.push(options);
    return terminal;
  });

  manager.prepare(validInput);

  assert.deepEqual(created, [{ name: "ModBear", cwd: validInput.moduleRoot }]);
  assert.equal(terminal.showCalls, 1);
  assert.deepEqual(terminal.sent, [{
    text: "go get github.com/gin-gonic/gin@v1.10.1",
    shouldExecute: false
  }]);
});

test("reuses a live terminal for the same module root", () => {
  const terminals = [new FakeTerminal(), new FakeTerminal()];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  manager.prepare(validInput);
  manager.prepare({ ...validInput, version: "v1.11.0" });

  assert.equal(creations, 1);
  assert.equal(terminals[0]!.sent.length, 2);
});

test("forgets a closed terminal before the next preparation", () => {
  const terminals = [new FakeTerminal(), new FakeTerminal()];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  manager.prepare(validInput);
  manager.forget(terminals[0]!);
  manager.prepare(validInput);

  assert.equal(creations, 2);
  assert.equal(terminals[1]!.sent.length, 1);
});
