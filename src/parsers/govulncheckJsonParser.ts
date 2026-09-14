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
    advisories,
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

  const scannerName = optionalString(config, "scanner_name", lineNumber, "config");
  const scannerVersion = optionalString(config, "scanner_version", lineNumber, "config");
  const database = optionalString(config, "db", lineNumber, "config");
  const databaseLastModified = optionalString(config, "db_last_modified", lineNumber, "config");
  const goVersion = optionalString(config, "go_version", lineNumber, "config");
  const scanLevel = optionalString(config, "scan_level", lineNumber, "config");
  const scanMode = optionalString(config, "scan_mode", lineNumber, "config");

  return Object.freeze({
    protocolVersion,
    ...(scannerName !== undefined ? { scannerName } : {}),
    ...(scannerVersion !== undefined ? { scannerVersion } : {}),
    ...(database !== undefined ? { database } : {}),
    ...(databaseLastModified !== undefined ? { databaseLastModified } : {}),
    ...(goVersion !== undefined ? { goVersion } : {}),
    ...(scanLevel !== undefined ? { scanLevel } : {}),
    ...(scanMode !== undefined ? { scanMode } : {}),
  });
}

function parseProgress(value: unknown, lineNumber: number): GovulncheckProgress {
  const progress = record(value, lineNumber, "progress");
  const timestamp = optionalString(progress, "time", lineNumber, "progress");
  const message = optionalString(progress, "message", lineNumber, "progress");
  return Object.freeze({
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(message !== undefined ? { message } : {}),
  });
}

function parseAdvisory(value: unknown, lineNumber: number): GovulncheckAdvisory {
  const advisory = record(value, lineNumber, "osv");
  const summary = optionalString(advisory, "summary", lineNumber, "osv");
  const details = optionalString(advisory, "details", lineNumber, "osv");
  const aliases = optionalStringArray(advisory, "aliases", lineNumber, "osv");
  const published = optionalString(advisory, "published", lineNumber, "osv");
  const modified = optionalString(advisory, "modified", lineNumber, "osv");
  return Object.freeze({
    id: requiredString(advisory, "id", lineNumber, "osv"),
    ...(summary !== undefined ? { summary } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(aliases !== undefined ? { aliases: Object.freeze(aliases) } : {}),
    ...(published !== undefined ? { published } : {}),
    ...(modified !== undefined ? { modified } : {}),
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
    ...(fixedVersion !== undefined ? { fixedVersion } : {}),
    trace: Object.freeze(trace),
  });
}

function parseTraceFrame(value: unknown, lineNumber: number): GovulncheckTraceFrame {
  const frame = record(value, lineNumber, "finding.trace frame");
  const version = optionalString(frame, "version", lineNumber, "finding.trace frame");
  const pkg = optionalString(frame, "package", lineNumber, "finding.trace frame");
  const fn = optionalString(frame, "function", lineNumber, "finding.trace frame");
  const receiver = optionalString(frame, "receiver", lineNumber, "finding.trace frame");
  const position = frame.position === undefined ? undefined : parsePosition(frame.position, lineNumber);
  return Object.freeze({
    module: requiredString(frame, "module", lineNumber, "finding.trace frame"),
    ...(version !== undefined ? { version } : {}),
    ...(pkg !== undefined ? { package: pkg } : {}),
    ...(fn !== undefined ? { function: fn } : {}),
    ...(receiver !== undefined ? { receiver } : {}),
    ...(position !== undefined ? { position } : {}),
  });
}

function parsePosition(value: unknown, lineNumber: number): GovulncheckPosition {
  const position = record(value, lineNumber, "finding.trace position");
  const filename = optionalString(position, "filename", lineNumber, "finding.trace position");
  const offset = optionalNumber(position, "offset", lineNumber, "finding.trace position");
  const line = optionalNumber(position, "line", lineNumber, "finding.trace position");
  const column = optionalNumber(position, "column", lineNumber, "finding.trace position");
  return Object.freeze({
    ...(filename !== undefined ? { filename } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
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

function optionalNumber(value: JsonRecord, name: string, lineNumber: number, label: string): number | undefined {
  const parsed = value[name];
  if (parsed === undefined) return undefined;
  if (typeof parsed !== "number") throw invalid(lineNumber, `${label}.${name} must be a number`);
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(lineNumber: number, reason: string): Error {
  return new Error(`Invalid govulncheck JSON at line ${lineNumber}: ${reason}`);
}
