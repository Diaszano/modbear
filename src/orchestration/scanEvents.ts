import { EventEmitter } from "node:events";
import type { ModuleAnalysisSnapshot } from "../domain/analysis";

export class ScanEvents extends EventEmitter {
  public emitSnapshot(snapshot: ModuleAnalysisSnapshot): void {
    this.emit("snapshot", snapshot);
  }

  public onSnapshot(listener: (snapshot: ModuleAnalysisSnapshot) => void): () => void {
    this.on("snapshot", listener);
    return () => this.off("snapshot", listener);
  }
}
