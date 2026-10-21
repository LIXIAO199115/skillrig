#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main().catch((error) => {
  if (error && error.name === "UsageError") {
    process.stderr.write(`skillrig: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`skillrig: ${error && error.message ? error.message : String(error)}\n`);
  if (process.env.SKILLRIG_DEBUG && error && error.stack) process.stderr.write(error.stack + "\n");
  process.exit(1);
});
