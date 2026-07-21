const [mode, value] = process.argv.slice(2);
if (mode === "echo") process.stdout.write(`${value}\n`);
if (mode === "sleep") await new Promise((resolve) => setTimeout(resolve, Number(value)));
