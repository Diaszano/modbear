import type {
  GovulncheckAdvisory,
  GovulncheckConfig,
  GovulncheckFinding,
  GovulncheckPosition,
  GovulncheckProgress,
  GovulncheckStream,
  GovulncheckTraceFrame,
} from "../domain/vulnerability";

type JsonRecord = Readonly<Record<string, unknown>>;

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #entries: Map<K, V>;

  constructor(entries: ReadonlyMap<K, V>) {
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#entries.forEach((value, key) => {
      callbackfn.call(thisArg, value, key, this);
    });
  }

  entries(): IterableIterator<[K, V]> {
    return this.#entries.entries();
  }

  keys(): IterableIterator<K> {
    return this.#entries.keys();
  }

  values(): IterableIterator<V> {
    return this.#entries.values();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

export function parseGovulncheckStream(input: string): GovulncheckStream {
  let config: GovulncheckConfig | undefined;
  const advisories = new Map<string, GovulncheckAdvisory>();
  const findings: GovulncheckFinding[] = [];
  const progress: GovulncheckProgress[] = [];
  let messageCount = 0;

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    const lineNumber = index + 1;
    const message = parseLine(line, lineNumber);
    const knownMessageNames = ["config", "progress", "osv", "finding"].filter((name) => message[name] !== undefined);

    if (knownMessageNames.length > 1) {
      throw invalid(lineNumber, "contains more than one known message");
    }

    if (messageCount === 0 && message.config === undefined) {
      throw invalid(lineNumber, "the first message must contain config");
    }
    messageCount += 1;

    if (message.config !== undefined) {
      if (config !== undefined) throw invalid(lineNumber, "stream must contain exactly one config");
      config = parseConfig(message.config, lineNumber);
      continue;
    }
    if (message.progress !== undefined) {
      progress.push(parseProgress(message.progress, lineNumber));
      continue;
    }
    if (message.osv !== undefined) {
      const advisory = parseAdvisory(message.osv, lineNumber);
      advisories.set(advisory.id, advisory);
      continue;
    }
    if (message.finding !== undefined) {
      findings.push(parseFinding(message.finding, lineNumber));
    }
  }

  if (config === undefined) throw new Error("govulncheck stream must contain exactly one config");
  return Object.freeze({
    config,
    advisories: new ImmutableMap(advisories),
    findings: Object.freeze(findings),
    progress: Object.freeze(progress),
  });
}

function parseLine(line: string, lineNumber: number): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) throw invalid(lineNumber, "must be a JSON object");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes(`line ${lineNumber}`)) throw error;
    throw invalid(lineNumber, "contains malformed JSON");
  }
}

function parseConfig(value: unknown, lineNumber: number): GovulncheckConfig {
  const config = record(value, lineNumber, "config");
  const protocolVersion = requiredString(config, "protocol_version", lineNumber, "config");
  const version = /^v(\d+)(?:\.|$)/.exec(protocolVersion);
  if (version?.[1] !== "1") throw new Error(`Unsupported govulncheck protocol ${protocolVersion}`);

  return Object.freeze({
    protocolVersion,
    ...optionalStringProperty(config, "scanner_name", "scannerName", lineNumber, "config"),
    ...optionalStringProperty(config, "scanner_version", "scannerVersion", lineNumber, "config"),
    ...optionalStringProperty(config, "db", "database", lineNumber, "config"),
    ...optionalStringProperty(config, "db_last_modified", "databaseLastModified", lineNumber, "config"),
    ...optionalStringProperty(config, "go_version", "goVersion", lineNumber, "config"),
    ...optionalStringProperty(config, "scan_level", "scanLevel", lineNumber, "config"),
    ...optionalStringProperty(config, "scan_mode", "scanMode", lineNumber, "config"),
  });
}

function parseProgress(value: unknown, lineNumber: number): GovulncheckProgress {
  const progress = record(value, lineNumber, "progress");
  return Object.freeze({
    ...optionalStringProperty(progress, "time", "timestamp", lineNumber, "progress"),
    ...optionalStringProperty(progress, "message", "message", lineNumber, "progress"),
  });
}

function parseAdvisory(value: unknown, lineNumber: number): GovulncheckAdvisory {
  const advisory = record(value, lineNumber, "osv");
  const aliases = optionalStringArray(advisory, "aliases", lineNumber, "osv");
  return Object.freeze({
    id: requiredString(advisory, "id", lineNumber, "osv"),
    ...optionalStringProperty(advisory, "summary", "summary", lineNumber, "osv"),
    ...optionalStringProperty(advisory, "details", "details", lineNumber, "osv"),
    ...(aliases === undefined ? {} : { aliases: Object.freeze(aliases) }),
    ...optionalStringProperty(advisory, "published", "published", lineNumber, "osv"),
    ...optionalStringProperty(advisory, "modified", "modified", lineNumber, "osv"),
  });
}

function parseFinding(value: unknown, lineNumber: number): GovulncheckFinding {
  const finding = record(value, lineNumber, "finding");
  const trace =
    finding.trace === undefined
      ? []
      : array(finding.trace, lineNumber, "finding.trace").map((frame) => parseTraceFrame(frame, lineNumber));
  const fixedVersion = optionalString(finding, "fixed_version", lineNumber, "finding");
  return Object.freeze({
    osvId: requiredString(finding, "osv", lineNumber, "finding"),
    ...(fixedVersion === undefined ? {} : { fixedVersion }),
    trace: Object.freeze(trace),
  });
}

function parseTraceFrame(value: unknown, lineNumber: number): GovulncheckTraceFrame {
  const frame = record(value, lineNumber, "finding.trace frame");
  const position = frame.position === undefined ? undefined : parsePosition(frame.position, lineNumber);
  return Object.freeze({
    module: requiredString(frame, "module", lineNumber, "finding.trace frame"),
    ...optionalStringProperty(frame, "version", "version", lineNumber, "finding.trace frame"),
    ...optionalStringProperty(frame, "package", "package", lineNumber, "finding.trace frame"),
    ...optionalStringProperty(frame, "function", "function", lineNumber, "finding.trace frame"),
    ...optionalStringProperty(frame, "receiver", "receiver", lineNumber, "finding.trace frame"),
    ...(position === undefined ? {} : { position }),
  });
}

function parsePosition(value: unknown, lineNumber: number): GovulncheckPosition {
  const position = record(value, lineNumber, "finding.trace position");
  return Object.freeze({
    ...optionalStringProperty(position, "filename", "filename", lineNumber, "finding.trace position"),
    ...optionalNumberProperty(position, "offset", lineNumber, "finding.trace position"),
    ...optionalNumberProperty(position, "line", lineNumber, "finding.trace position"),
    ...optionalNumberProperty(position, "column", lineNumber, "finding.trace position"),
  });
}

function record(value: unknown, lineNumber: number, label: string): JsonRecord {
  if (!isRecord(value)) throw invalid(lineNumber, `${label} must be an object`);
  return value;
}

function array(value: unknown, lineNumber: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalid(lineNumber, `${label} must be an array`);
  return value;
}

function requiredString(value: JsonRecord, name: string, lineNumber: number, label: string): string {
  const parsed = optionalString(value, name, lineNumber, label);
  if (parsed === undefined) throw invalid(lineNumber, `${label}.${name} must be a string`);
  return parsed;
}

function optionalString(value: JsonRecord, name: string, lineNumber: number, label: string): string | undefined {
  const parsed = value[name];
  if (parsed === undefined) return undefined;
  if (typeof parsed !== "string") throw invalid(lineNumber, `${label}.${name} must be a string`);
  return parsed;
}

function optionalStringArray(value: JsonRecord, name: string, lineNumber: number, label: string): string[] | undefined {
  const parsed = value[name];
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw invalid(lineNumber, `${label}.${name} must be an array of strings`);
  }
  return [...parsed];
}

function optionalStringProperty(
  value: JsonRecord,
  inputName: string,
  outputName: string,
  lineNumber: number,
  label: string,
): Readonly<Record<string, string>> {
  const parsed = optionalString(value, inputName, lineNumber, label);
  return parsed === undefined ? {} : { [outputName]: parsed };
}

function optionalNumberProperty(
  value: JsonRecord,
  name: string,
  lineNumber: number,
  label: string,
): Readonly<Record<string, number>> {
  const parsed = value[name];
  if (parsed === undefined) return {};
  if (typeof parsed !== "number") throw invalid(lineNumber, `${label}.${name} must be a number`);
  return { [name]: parsed };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(lineNumber: number, reason: string): Error {
  return new Error(`Invalid govulncheck JSON at line ${lineNumber}: ${reason}`);
}
