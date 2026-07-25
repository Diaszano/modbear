import path from "node:path";
import type { ModuleContext } from "../domain/module";

export function resolveActiveModule(
  documentPath: string,
  modules: readonly ModuleContext[],
): ModuleContext | undefined {
  const normalized = path.resolve(documentPath);
  return modules
    .filter(
      (module) =>
        normalized === module.goModPath ||
        normalized === module.moduleRoot ||
        normalized.startsWith(`${module.moduleRoot}${path.sep}`),
    )
    .sort((a, b) => b.moduleRoot.length - a.moduleRoot.length)[0];
}
