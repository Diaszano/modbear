require("node:fs").writeSync(process.stderr.fd, "proxy https://user:password@example.test failed\n");
process.exit(7);
