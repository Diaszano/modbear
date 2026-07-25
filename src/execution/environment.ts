export function appendReadonlyGoFlags(current: string | undefined): string {
  const flags = (current ?? "").trim();
  if (/(^|\s)-mod=readonly(?:\s|$)/.test(flags)) return flags;
  return [flags, "-mod=readonly"].filter(Boolean).join(" ");
}

export function buildGoEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GOFLAGS: appendReadonlyGoFlags(base.GOFLAGS),
  };
}
