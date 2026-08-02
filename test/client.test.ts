import assert from "node:assert/strict";
import test from "node:test";

import type { CredentialStore } from "../src/auth/storage.js";
import { GiftfulClient } from "../src/giftful/client.js";
import type { AuthRecord } from "../src/giftful/types.js";

class MemoryStore implements CredentialStore {
  record: AuthRecord | null = null;
  saves = 0;
  clears = 0;

  description(): string {
    return "memory";
  }
  async load(): Promise<AuthRecord | null> {
    return this.record;
  }
  async save(record: AuthRecord): Promise<void> {
    this.saves += 1;
    this.record = structuredClone(record);
  }
  async clear(): Promise<void> {
    this.clears += 1;
    this.record = null;
  }
}

const user = {
  id: 7,
  username: "tester",
  firstName: "Test",
  lastName: "User",
  email: "test@example.com",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jwt(expSeconds: number): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp: expSeconds })}.signature`;
}

test("login stores only refresh credentials and user metadata", async () => {
  const store = new MemoryStore();
  const accessToken = jwt(Math.floor(Date.now() / 1000) + 3600);
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables: unknown;
    };
    assert.match(request.query, /mutation Login/);
    return jsonResponse({
      data: {
        login: {
          accessToken,
          refreshToken: { id: 12, token: "refresh-secret" },
          user,
        },
      },
    });
  };
  const client = new GiftfulClient(store, { fetchImpl });

  await client.login("test@example.com", "password-that-must-not-be-stored");

  assert.equal(store.record?.refreshToken.token, "refresh-secret");
  const persisted = JSON.stringify(store.record);
  assert.doesNotMatch(persisted, /password-that-must-not-be-stored/);
  assert.doesNotMatch(
    persisted,
    new RegExp(accessToken.replaceAll(".", "\\.")),
  );
});

test("browser refresh credentials are validated before being persisted", async () => {
  const store = new MemoryStore();
  const accessToken = jwt(Math.floor(Date.now() / 1000) + 3600);
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables: { id: number; token: string };
    };
    assert.match(request.query, /mutation RefreshToken/);
    assert.deepEqual(request.variables, {
      id: 44,
      token: "browser-refresh-secret",
    });
    return jsonResponse({ data: { refreshToken: { accessToken, user } } });
  };
  const client = new GiftfulClient(store, { fetchImpl });

  const importedUser = await client.importRefreshToken({
    id: 44,
    token: "browser-refresh-secret",
  });

  assert.deepEqual(importedUser, user);
  assert.equal(store.saves, 1);
  assert.equal(store.record?.refreshToken.token, "browser-refresh-secret");
  assert.doesNotMatch(
    JSON.stringify(store.record),
    new RegExp(accessToken.replaceAll(".", "\\.")),
  );
});

test("authentication status exposes only the username from user metadata", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "refresh-secret" },
    user,
  };
  const client = new GiftfulClient(store, {
    fetchImpl: async () => {
      throw new Error("status without validation must not call Giftful");
    },
  });

  const status = await client.authStatus(false);

  assert.deepEqual(status, {
    authenticated: true,
    username: "tester",
    storage: "memory",
    validated: false,
  });
  assert.doesNotMatch(JSON.stringify(status), /test@example\.com|Test|User/);
});

test("a fresh client silently refreshes and authenticates list requests", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "refresh-secret" },
    user,
  };
  const newAccessToken = jwt(Math.floor(Date.now() / 1000) + 3600);
  const calls: Array<{ query: string; authorization?: string }> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { query: string };
    const headers = new Headers(init?.headers);
    calls.push({
      query: request.query,
      ...(headers.get("authorization")
        ? { authorization: headers.get("authorization") ?? undefined }
        : {}),
    });
    if (request.query.includes("mutation RefreshToken")) {
      return jsonResponse({
        data: { refreshToken: { accessToken: newAccessToken, user } },
      });
    }
    return jsonResponse({ data: { wishlists: [] } });
  };

  const client = new GiftfulClient(store, { fetchImpl });
  const lists = await client.listWishlists();

  assert.deepEqual(lists, []);
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.query ?? "", /mutation RefreshToken/);
  assert.equal(calls[0]?.authorization, undefined);
  assert.match(calls[1]?.query ?? "", /query Wishlists/);
  assert.equal(calls[1]?.authorization, `Bearer ${newAccessToken}`);
});

test("social navigation lists friend lists, followers, and active following", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "refresh-secret" },
    user,
  };
  const accessToken = jwt(Math.floor(Date.now() / 1000) + 3600);
  const requests: Array<{ query: string; variables: Record<string, unknown> }> =
    [];
  const client = new GiftfulClient(store, {
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (request.query.includes("mutation RefreshToken")) {
        return jsonResponse({ data: { refreshToken: { accessToken, user } } });
      }
      requests.push(request);
      assert.doesNotMatch(request.query, /\bemail\b/);
      if (request.query.includes("query FollowingWishlists")) {
        return jsonResponse({
          data: {
            followingWishlists: [
              {
                id: 30,
                userId: 8,
                slug: "friend-list",
                name: "Friend list",
                isPrivate: false,
                user: { id: 8, username: "friend" },
              },
            ],
          },
        });
      }
      if (request.query.includes("query Followers")) {
        return jsonResponse({
          data: {
            followers: [{ id: 40, userId: 7, followerId: 8, status: 0 }],
          },
        });
      }
      if (request.query.includes("query Following")) {
        return jsonResponse({
          data: {
            following: [{ id: 41, userId: 8, followerId: 7, status: 1 }],
          },
        });
      }
      throw new Error("Unexpected social navigation operation.");
    },
  });

  const friendLists = await client.listFriendWishlists({
    page: 2,
    perPage: 20,
  });
  const followers = await client.listFollowers({ page: 3, perPage: 25 });
  const following = await client.listFollowing({ page: 4, perPage: 30 });

  assert.equal(friendLists[0]?.slug, "friend-list");
  assert.equal(followers[0]?.statusName, "pending");
  assert.equal(following[0]?.statusName, "active");
  assert.deepEqual(
    requests.map((request) => request.variables),
    [
      { page: 2, perPage: 20 },
      { userId: 7, page: 3, perPage: 25 },
      { userId: 7, active: true, page: 4, perPage: 30 },
    ],
  );
});

test("claim and unclaim reserve wishes without pretending to purchase them", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "refresh-secret" },
    user,
  };
  const accessToken = jwt(Math.floor(Date.now() / 1000) + 3600);
  const operations: string[] = [];
  const client = new GiftfulClient(store, {
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { wishId?: number };
      };
      if (request.query.includes("mutation RefreshToken")) {
        return jsonResponse({ data: { refreshToken: { accessToken, user } } });
      }
      assert.deepEqual(request.variables, { wishId: 55 });
      if (request.query.includes("mutation Claim")) {
        operations.push("claim");
        return jsonResponse({
          data: {
            claim: {
              id: 55,
              name: "Gift",
              quantity: 1,
              userId: 8,
              wishlistId: 30,
              acceptedBy: 7,
            },
          },
        });
      }
      if (request.query.includes("mutation Unclaim")) {
        operations.push("unclaim");
        return jsonResponse({
          data: {
            unclaim: {
              id: 55,
              name: "Gift",
              quantity: 1,
              userId: 8,
              wishlistId: 30,
              acceptedBy: null,
            },
          },
        });
      }
      throw new Error("Unexpected claim operation.");
    },
  });

  const claimed = await client.claimWish(55);
  const unclaimed = await client.unclaimWish(55);

  assert.equal(claimed.acceptedBy, 7);
  assert.equal(unclaimed.acceptedBy, null);
  assert.deepEqual(operations, ["claim", "unclaim"]);
});

test("wish updates stop after a bounded lookup", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "refresh-secret" },
    user,
  };
  const accessToken = jwt(Math.floor(Date.now() / 1000) + 3600);
  let wishPageCalls = 0;
  const client = new GiftfulClient(store, {
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { page?: number };
      };
      if (request.query.includes("mutation RefreshToken")) {
        return jsonResponse({ data: { refreshToken: { accessToken, user } } });
      }
      if (request.query.includes("query Wishlist(")) {
        return jsonResponse({ data: { wishlist: { id: 99 } } });
      }
      if (request.query.includes("query Wishes(")) {
        wishPageCalls += 1;
        const firstId = (request.variables.page ?? 1) * 100;
        return jsonResponse({
          data: {
            wishes: Array.from({ length: 100 }, (_, index) => ({
              id: firstId + index,
            })),
          },
        });
      }
      throw new Error("Unexpected Giftful operation in bounded lookup test.");
    },
  });

  await assert.rejects(
    () => client.updateWish("huge-list", 999_999, { name: "Never reached" }),
    /first 2000 wishes.*refusing to make more lookup requests/,
  );
  assert.equal(wishPageCalls, 20);
});

test("temporary network failures do not erase the persistent refresh token", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "refresh-secret" },
    user,
  };
  const client = new GiftfulClient(store, {
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  await assert.rejects(
    () => client.authStatus(true),
    /Unable to reach Giftful/,
  );
  assert.equal(store.record?.refreshToken.token, "refresh-secret");
  assert.equal(store.clears, 0);
});

test("an invalid refresh token is removed and requests re-login", async () => {
  const store = new MemoryStore();
  store.record = {
    schemaVersion: 1,
    refreshToken: { id: 12, token: "bad-refresh" },
    user,
  };
  const client = new GiftfulClient(store, {
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: "Invalid token" }] }),
  });

  await assert.rejects(
    () => client.authStatus(true),
    /rejected the saved session/,
  );
  assert.equal(store.record, null);
  assert.equal(store.clears, 1);
});
