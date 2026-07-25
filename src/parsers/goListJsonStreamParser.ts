import { StringDecoder } from "node:string_decoder";
import { GoListModule } from "./goListJsonParser";

export class GoListJsonStreamParser {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private buffer = "";
  private start = -1;
  private readonly modules: GoListModule[] = [];
  private readonly decoder = new StringDecoder("utf8");

  public push(chunk: Buffer): void {
    const text = this.decoder.write(chunk);
    if (!text) {
      return;
    }
    const startScanIndex = Math.max(0, this.buffer.length);
    this.buffer += text;

    let index = startScanIndex;
    while (index < this.buffer.length) {
      const char = this.buffer[index];
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (char === "\\") {
          this.escaped = true;
        } else if (char === '"') {
          this.inString = false;
        }
        index++;
        continue;
      }
      if (char === '"') {
        this.inString = true;
        index++;
        continue;
      }
      if (char === "{") {
        if (this.depth === 0) {
          this.start = index;
        }
        this.depth++;
        index++;
      } else if (char === "}") {
        this.depth--;
        if (this.depth === 0 && this.start >= 0) {
          const objStr = this.buffer.slice(this.start, index + 1);
          const parsed = JSON.parse(objStr);
          if (isGoListModule(parsed)) {
            this.modules.push(parsed);
          }
          // Discard parsed object from the buffer to keep memory usage bounded.
          this.buffer = this.buffer.slice(index + 1);
          index = 0;
          this.start = -1;
        } else {
          index++;
        }
      } else {
        index++;
      }
    }
  }

  public finish(): readonly GoListModule[] {
    const text = this.decoder.end();
    if (text) {
      this.push(Buffer.from(text, "utf8"));
    }
    const remaining = this.buffer.trim();
    if (remaining.length > 0 || this.depth !== 0 || this.inString) {
      throw new Error("Incomplete go list JSON stream");
    }
    return this.modules;
  }
}

function isGoListModule(value: unknown): value is GoListModule {
  return typeof value === "object" && value !== null && typeof (value as { Path?: unknown }).Path === "string";
}
