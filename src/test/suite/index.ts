import path from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20_000 });
  const root = __dirname;
  for (const file of await glob("**/*.test.js", { cwd: root, absolute: true })) {
    if (path.resolve(file) !== path.resolve(__filename)) mocha.addFile(file);
  }
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => failures > 0 ? reject(new Error(`${failures} extension tests failed`)) : resolve());
  });
}
