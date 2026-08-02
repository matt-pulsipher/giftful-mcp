#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createGiftfulMcpServer } from "./server.js";

async function main(): Promise<void> {
  const { server } = await createGiftfulMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("giftful-mcp failed to start:", error);
  process.exitCode = 1;
});
