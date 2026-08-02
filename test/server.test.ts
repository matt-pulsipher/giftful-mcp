import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { CredentialStore } from "../src/auth/storage.js";
import type { AuthRecord } from "../src/giftful/types.js";
import { createGiftfulMcpServer } from "../src/server.js";

class EmptyStore implements CredentialStore {
  description(): string {
    return "test store";
  }
  async load(): Promise<AuthRecord | null> {
    return null;
  }
  async save(): Promise<void> {}
  async clear(): Promise<void> {}
}

test("MCP handshake exposes the complete Giftful tool set", async () => {
  const { server } = await createGiftfulMcpServer({ store: new EmptyStore() });
  const client = new Client({ name: "giftful-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "giftful_add_wish",
      "giftful_auth_status",
      "giftful_claim_wish",
      "giftful_create_category",
      "giftful_create_list",
      "giftful_delete_category",
      "giftful_delete_list",
      "giftful_delete_wish",
      "giftful_get_list",
      "giftful_list_followers",
      "giftful_list_following",
      "giftful_list_friend_lists",
      "giftful_list_lists",
      "giftful_list_wishes",
      "giftful_logout",
      "giftful_unclaim_wish",
      "giftful_update_list",
      "giftful_update_wish",
    ]);

    const status = await client.callTool({
      name: "giftful_auth_status",
      arguments: { validate: false },
    });
    assert.equal(status.isError, undefined);
    assert.deepEqual(status.structuredContent, {
      authenticated: false,
      username: null,
      storage: "test store",
      validated: false,
      login: {
        browser:
          "Run `giftful-auth login-browser` (source checkout: `npm run auth -- login-browser`).",
        password:
          "Run `giftful-auth login USERNAME` (source checkout: `npm run auth -- login USERNAME`). The password is prompted without echoing.",
      },
    });

    const unconfirmedClaim = await client.callTool({
      name: "giftful_claim_wish",
      arguments: { wish_id: 123, confirm: false },
    });
    assert.equal(unconfirmedClaim.isError, true);
    assert.match(
      String(
        unconfirmedClaim.content[0]?.type === "text" &&
          unconfirmedClaim.content[0].text,
      ),
      /Set confirm=true to claim wish 123/,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
