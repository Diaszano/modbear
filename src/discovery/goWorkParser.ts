export function parseGoWorkUses(text: string): readonly string[] {
  const uses: string[] = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/\/\/.*$/, "").trim();
    if (!trimmed) continue;
    if (/^use\s*\($/.test(trimmed)) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ")") {
      inBlock = false;
      continue;
    }
    const match = inBlock
      ? /^("[^"]+"|\S+)$/.exec(trimmed)
      : /^use\s+("[^"]+"|\S+)$/.exec(trimmed);
    if (match?.[1]) uses.push(match[1].replace(/^"|"$/g, ""));
  }
  return uses;
}
