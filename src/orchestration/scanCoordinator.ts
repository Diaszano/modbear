import type { ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { ScanEvents } from "./scanEvents";

export interface ModuleScanRequest {
  readonly module: ModuleContext;
  readonly contentHash: string;
  readonly run: (signal: AbortSignal) => Promise<ModuleAnalysisSnapshot>;
}

export class ScanCoordinator {
  private readonly running = new Map<string, AbortController>();
  private readonly snapshots = new Map<string, ModuleAnalysisSnapshot>();
  public readonly events = new ScanEvents();

  public getSnapshot(moduleId: string): ModuleAnalysisSnapshot | undefined {
    return this.snapshots.get(moduleId);
  }

  public async scanModule(request: ModuleScanRequest): Promise<ModuleAnalysisSnapshot> {
    this.running.get(request.module.id)?.abort();
    const controller = new AbortController();
    this.running.set(request.module.id, controller);
    try {
      const snapshot = Object.freeze(await request.run(controller.signal));
      if (controller.signal.aborted) throw new Error("Scan cancelled");
      this.snapshots.set(request.module.id, snapshot);
      this.events.emitSnapshot(snapshot);
      return snapshot;
    } finally {
      if (this.running.get(request.module.id) === controller) this.running.delete(request.module.id);
    }
  }

  public dispose(): void {
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }
}
