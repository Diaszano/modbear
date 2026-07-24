export function redactUrlCredentials(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, "$1***@");
}

export function redactLogText(value: string): string {
  return redactUrlCredentials(value)
    .replace(/(^|[\s=])(?:~\/|\/(?:[^\s"'`]+))/g, "$1[redacted-path]")
    .replace(/(^|[\s=])(?:[a-z]:[\\/]|\\\\)[^\s"'`]*/gi, "$1[redacted-path]")
    .replace(/(\bauthorization\s*[=:])(\s*)(?:"[^"]*"|'[^']*'|[a-z][a-z0-9!#$%&'*+.^_`|~-]*\s+)?[^\s,;]+/gi, "$1$2***")
    .replace(/\b([\w.-]*(?:token|secret|password|proxy)[\w.-]*)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1$2***");
}

export function redactCommand(args: readonly string[]): readonly string[] {
  return args.map((arg) => redactLogText(arg));
}

export function redactLogMessage(message: string): string {
  return redactLogText(message);
}
