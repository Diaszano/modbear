import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID } from "../../metadata";

test("exports the stable extension id", () => {
  assert.equal(EXTENSION_ID, "diaszano.modbear");
});
