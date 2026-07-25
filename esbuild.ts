import { analyzeMetafile, build, context, type BuildOptions } from "esbuild";
import buildConfig from "./esbuild.config.json" with { type: "json" };

const supportedFlags = new Set(["--production", "--watch", "--analyze"]);
const flags = new Set(process.argv.slice(2));

for (const flag of flags) {
  if (!supportedFlags.has(flag)) {
    throw new Error(`Unsupported build flag: ${flag}`);
  }
}

const production = flags.has("--production");
const watch = flags.has("--watch");
const analyze = flags.has("--analyze");

if (watch && analyze) {
  throw new Error("--watch cannot be combined with --analyze");
}

const options: BuildOptions = {
  ...(buildConfig as BuildOptions),
  logLevel: "info",
  metafile: analyze,
  minify: production,
  sourcemap: production ? false : "linked",
};

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  const result = await build(options);
  if (analyze) {
    if (!result.metafile) {
      throw new Error("Build analysis requires metafile output");
    }
    console.log(await analyzeMetafile(result.metafile));
  }
}
