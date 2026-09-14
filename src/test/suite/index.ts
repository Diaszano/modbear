import path from "node:path";
import Mocha from "mocha";
import { glob } from "node:fs/promises";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20_000 });
  const root = __dirname;
  for await (const file of glob("**/*.test.js", { cwd: root })) {
    const fullPath = path.resolve(root, file);
    if (fullPath !== path.resolve(__filename)) mocha.addFile(fullPath);
  }
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension tests failed`));
      } else {
        resolve();
      }
    });
  });
}
