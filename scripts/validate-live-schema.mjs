#!/usr/bin/env node
import * as operations from "../dist/giftful/operations.js";

const endpoint =
  process.env.GIFTFUL_GRAPHQL_URL ?? "https://api.giftful.com/graphql";
const missing = "__giftful_mcp_schema_check__";
const checks = [
  ["LIST_WISHLISTS", { username: missing }],
  ["LIST_FRIEND_WISHLISTS", { page: 1, perPage: 1 }],
  ["LIST_FOLLOWERS", { userId: -2147483648, page: 1, perPage: 1 }],
  [
    "LIST_FOLLOWING",
    { userId: -2147483648, active: true, page: 1, perPage: 1 },
  ],
  ["GET_WISHLIST", { slug: missing }],
  ["GET_WISHLIST_BLOCK", { wishlistId: -2147483648 }],
  [
    "CREATE_WISHLIST",
    {
      name: missing,
      type: 1,
      isPrivate: true,
      allowReactions: false,
      publicView: false,
      guest: false,
      recipientId: -2147483648,
      useCoverAsPreview: false,
    },
  ],
  [
    "UPDATE_WISHLIST",
    {
      wishlistId: -2147483648,
      name: missing,
      type: 1,
      isPrivate: true,
      allowReactions: false,
      publicView: false,
      guest: false,
      recipientId: -2147483648,
      useCoverAsPreview: false,
    },
  ],
  ["DELETE_WISHLIST", { slug: missing, userId: -2147483648 }],
  ["LIST_WISHES", { slug: missing, page: 1, perPage: 1, sortBy: "Default" }],
  ["CREATE_WISH", { wishlistId: -2147483648, name: missing, quantity: 1 }],
  [
    "UPDATE_WISH",
    {
      wishlistId: -2147483648,
      wishId: -2147483648,
      name: missing,
      quantity: 1,
    },
  ],
  ["DELETE_WISH", { wishId: -2147483648, wishlistId: -2147483648 }],
  ["CLAIM_WISH", { wishId: -2147483648 }],
  ["UNCLAIM_WISH", { wishId: -2147483648 }],
  ["CREATE_CATEGORY", { wishlistId: -2147483648, name: missing }],
  ["DELETE_CATEGORY", { id: -2147483648, wishlistId: -2147483648 }],
];

let failed = false;
for (const [name, variables] of checks) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ query: operations[name], variables }),
  });
  const payload = await response.json();
  const validationErrors = (payload.errors ?? []).filter(
    (error) =>
      error.extensions?.code === "GRAPHQL_VALIDATION_FAILED" ||
      /unknown (argument|type)|cannot query field|variable .* was not provided/i.test(
        error.message,
      ),
  );
  if (validationErrors.length) {
    failed = true;
    console.error(
      `FAIL ${name}: ${validationErrors.map((error) => error.message).join("; ")}`,
    );
  } else {
    console.log(`OK   ${name}`);
  }
}

process.exitCode = failed ? 1 : 0;
