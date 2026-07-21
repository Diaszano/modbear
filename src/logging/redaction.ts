export function redactUrlCredentials(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, "$1***@");
}

export function redactCommand(args: readonly string[]): readonly string[] {
  return args.map((arg) => redactUrlCredentials(arg));
}
