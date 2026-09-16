#!/usr/bin/env node
import { main } from '../src/mcp-server.js';

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
