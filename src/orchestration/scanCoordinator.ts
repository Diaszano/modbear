import { classifyAnalysisError, type ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { ScanEvents } from "./scanEvents";
import type { Logger } from "../logging/logger";

export interface ModuleScanRequest {
  readonly module: ModuleContext;
  readonly contentHash: string;
  readonly run: (signal: AbortSignal) => Promise<ModuleAnalysisSnapshot>;
}

export class ScanCoordinator {
  private readonly running = new Map<string, AbortController>();
  private readonly snapshots = new Map<string, ModuleAnalysisSnapshot>();
  public readonly events = new ScanEvents();

  private readonly queue: Array<{ request: ModuleScanRequest; resolve: (snap: ModuleAnalysisSnapshot) => void; reject: (err: any) => void }> = [];
  private activeCount = 0;

  public constructor(
    private readonly getMaxConcurrentModules: () => number = () => 2,
    private readonly logger?: Logger
  ) {}

  public getSnapshot(moduleId: string): ModuleAnalysisSnapshot | undefined {
    return this.snapshots.get(moduleId);
  }

  public async scanModule(request: ModuleScanRequest): Promise<ModuleAnalysisSnapshot> {
    this.running.get(request.module.id)?.abort();

    const existingIndex = this.queue.findIndex(item => item.request.module.id === request.module.id);
    if (existingIndex !== -1) {
      const existing = this.queue.splice(existingIndex, 1)[0];
      existing?.reject(new Error("Scan cancelled"));
      this.logger?.event("debug", "scan.cancelled", {});
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    const max = Math.max(1, this.getMaxConcurrentModules());
    while (this.activeCount < max && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.activeCount++;
      this.runScan(item.request).then(item.resolve).catch(item.reject).finally(() => {
        this.activeCount--;
        this.processQueue();
      });
    }
  }

  private async runScan(request: ModuleScanRequest): Promise<ModuleAnalysisSnapshot> {
    const controller = new AbortController();
    this.running.set(request.module.id, controller);
    try {
      let snapshot: ModuleAnalysisSnapshot;
      try {
        snapshot = Object.freeze(await request.run(controller.signal));
      } catch (err) {
        if (controller.signal.aborted) {
          this.logger?.event("debug", "scan.cancelled", {});
          throw err;
        }
        const previous = this.snapshots.get(request.module.id);
        const hasPreviousResults = previous?.updateState === "complete" || previous?.updateState === "partial";
        const snapshot: ModuleAnalysisSnapshot = hasPreviousResults
          ? Object.freeze({
              ...previous,
              contentHash: request.contentHash,
              createdAt: new Date().toISOString(),
              stale: true,
              updateState: "partial",
              errors: [{ code: classifyAnalysisError(err), message: "Dependency refresh failed." }]
            })
          : Object.freeze({
              moduleId: request.module.id,
              contentHash: request.contentHash,
              createdAt: new Date().toISOString(),
              stale: false,
              updateState: "failed",
              dependencies: [],
              replacements: [],
              vulnerabilities: { state: "not-run" as const, findings: [], advisories: {}, errors: [] },
              tidy: { state: "idle" as const, consistent: false, errors: [] },
              errors: [{ code: classifyAnalysisError(err), message: "Dependency analysis failed." }]
            });
        this.snapshots.set(request.module.id, snapshot);
        this.events.emitSnapshot(snapshot);
        throw err;
      }

      if (controller.signal.aborted) {
        this.logger?.event("debug", "scan.cancelled", {});
        throw new Error("Scan cancelled");
      }
      this.snapshots.set(request.module.id, snapshot);
      this.events.emitSnapshot(snapshot);
      return snapshot;
    } finally {
      if (this.running.get(request.module.id) === controller) this.running.delete(request.module.id);
    }
  }

  public dispose(): void {
    for (const item of this.queue) {
      item.reject(new Error("Scan cancelled"));
      this.logger?.event("debug", "scan.cancelled", {});
    }
    this.queue.length = 0;
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }
}
