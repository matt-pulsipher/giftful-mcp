import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileCredentialStore,
  SystemCredentialStore,
  createCredentialStore,
} from "../src/auth/storage.js";

test("automatic storage selects the cross-platform system credential store", async () => {
  const store = await createCredentialStore({ GIFTFUL_PROFILE: "test" });
  assert.ok(store instanceof SystemCredentialStore);
});

test("file credential fallback round-trips with owner-only permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "giftful-mcp-test-"));
  const path = join(directory, "session.json");
  const store = new FileCredentialStore("test", path);
  const record = {
    schemaVersion: 1 as const,
    refreshToken: { id: 1, token: "secret" },
    user: {
      id: 2,
      username: "tester",
      firstName: "Test",
      lastName: "User",
    },
  };

  await store.save(record);
  assert.deepEqual(await store.load(), record);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  await store.clear();
  assert.equal(await store.load(), null);
});

test(
  "native system credential storage round-trips without subprocess arguments",
  { skip: process.platform !== "darwin" },
  async () => {
    const profile = `automated-test-${process.pid}-${Date.now()}`;
    const store = new SystemCredentialStore(profile);
    const record = {
      schemaVersion: 1 as const,
      refreshToken: { id: 1, token: "keychain-secret" },
      user: {
        id: 2,
        username: "tester",
        firstName: "Test",
        lastName: "User",
      },
    };
    try {
      await store.save(record);
      assert.deepEqual(await store.load(), record);
      await store.clear();
      assert.equal(await store.load(), null);
    } finally {
      await store.clear().catch(() => undefined);
    }
  },
);
