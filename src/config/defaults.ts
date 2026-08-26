import type { ImportedVulnerabilitySeverity } from "../domain/analysis";

export const DEFAULTS = {
  enabled: true,
  goPath: "go",
  onOpen: true,
  onSave: true,
  updateTtlMinutes: 30,
  timeoutSeconds: 120,
  tidyEnabled: true,
  tidyTtlMinutes: 10,
  vulnerabilityTtlMinutes: 360,
  govulncheckPath: "govulncheck",
  vulnerabilityEnabled: true,
  vulnerabilityTimeoutSeconds: 600,
  vulnerabilityIncludeTests: false,
  vulnerabilityBuildTags: [] as readonly string[],
  vulnerabilityDatabase: "",
  importedVulnerabilitySeverity: "warning" as ImportedVulnerabilitySeverity,
  updateSeverity: "none" as const,
  maxConcurrentModules: 2,
  logLevel: "info" as const,
};
