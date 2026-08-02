import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createCredentialStore, type CredentialStore } from "./auth/storage.js";
import {
  GiftfulApiError,
  GiftfulClient,
  type GiftfulClientOptions,
} from "./giftful/client.js";
import type { ScrapedProduct } from "./giftful/types.js";

const listTypeSchema = z
  .enum(["wishlist", "registry", "personal"])
  .describe("Giftful list type.");

const listTypeIds = {
  wishlist: 1,
  registry: 2,
  personal: 3,
} as const;

function jsonResult(value: unknown) {
  const structured = value as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: structured,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const kind = error instanceof GiftfulApiError ? error.kind : "unexpected";
  return {
    content: [{ type: "text" as const, text: `${kind}: ${message}` }],
    isError: true as const,
  };
}

function requireConfirmation(confirm: boolean, action: string): void {
  if (!confirm) throw new Error(`Set confirm=true to ${action}.`);
}

export interface CreateServerOptions extends GiftfulClientOptions {
  store?: CredentialStore;
}

export async function createGiftfulMcpServer(
  options: CreateServerOptions = {},
) {
  const store = options.store ?? (await createCredentialStore());
  const client = new GiftfulClient(store, options);
  const server = new McpServer(
    { name: "giftful-mcp", version: "0.2.0" },
    {
      instructions:
        "Manage the authenticated user's Giftful lists and wishes, and navigate the lists of people they follow. Call giftful_auth_status before Giftful operations. Authentication is CLI-only: if login is required, give the user the commands returned by giftful_auth_status. Never ask the user to put a password in chat. Prefer slugs returned by giftful_list_lists or giftful_list_friend_lists. Claiming reserves a wish inside Giftful but does not purchase it from a retailer. Deletion, claim, and unclaim tools require confirm=true.",
    },
  );

  server.registerTool(
    "giftful_auth_status",
    {
      title: "Giftful authentication status",
      description:
        "Check whether a persistent Giftful session exists. Set validate=true to verify it with Giftful.",
      inputSchema: {
        validate: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ validate }) => {
      try {
        return jsonResult(await client.authStatus(validate));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_logout",
    {
      title: "Log out of Giftful",
      description:
        "Revoke the current Giftful refresh token and remove the persisted local session.",
      inputSchema: {
        confirm: z
          .boolean()
          .describe(
            "Must be true because this removes persistent authentication.",
          ),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ confirm }) => {
      try {
        requireConfirmation(confirm, "log out and remove the saved session");
        await client.logout();
        return jsonResult({ authenticated: false });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_list_lists",
    {
      title: "List Giftful lists",
      description:
        "List the authenticated user's active Giftful wishlists, registries, and personal lists.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        return jsonResult({ lists: await client.listWishlists() });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_get_list",
    {
      title: "Get a Giftful list",
      description:
        "Get list settings, categories, collaborators, owner, and counts by Giftful slug.",
      inputSchema: { slug: z.string().min(1) },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ slug }) => {
      try {
        return jsonResult({ list: await client.getWishlist(slug) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_list_friend_lists",
    {
      title: "List friends' Giftful lists",
      description:
        "List accessible wishlists belonging to people the authenticated user follows. Returns slugs for giftful_get_list and giftful_list_wishes.",
      inputSchema: {
        page: z.number().int().positive().optional().default(1),
        per_page: z.number().int().min(1).max(100).optional().default(100),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ page, per_page }) => {
      try {
        return jsonResult({
          lists: await client.listFriendWishlists({ page, perPage: per_page }),
          page,
          per_page,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_list_followers",
    {
      title: "List Giftful followers",
      description:
        "List people who follow the authenticated user. This is read-only and cannot accept, decline, remove, or otherwise change relationships.",
      inputSchema: {
        page: z.number().int().positive().optional().default(1),
        per_page: z.number().int().min(1).max(100).optional().default(100),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ page, per_page }) => {
      try {
        return jsonResult({
          followers: await client.listFollowers({ page, perPage: per_page }),
          page,
          per_page,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_list_following",
    {
      title: "List people followed on Giftful",
      description:
        "List active Giftful accounts followed by the authenticated user. This is read-only and cannot follow or unfollow anyone.",
      inputSchema: {
        page: z.number().int().positive().optional().default(1),
        per_page: z.number().int().min(1).max(100).optional().default(100),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ page, per_page }) => {
      try {
        return jsonResult({
          following: await client.listFollowing({ page, perPage: per_page }),
          page,
          per_page,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_create_list",
    {
      title: "Create a Giftful list",
      description:
        "Create a wishlist, registry, or personal list for the authenticated user.",
      inputSchema: {
        name: z.string().min(1),
        type: listTypeSchema.optional().default("wishlist"),
        description: z.string().nullable().optional(),
        date: z
          .string()
          .nullable()
          .optional()
          .describe("Optional event date in YYYY-MM-DD form."),
        private: z.boolean().optional().default(false),
        public_view: z.boolean().optional().default(true),
        guest_claiming: z.boolean().optional().default(true),
        allow_reactions: z.boolean().optional().default(true),
        recipient_id: z.number().int().positive().optional(),
        claim_code: z.string().nullable().optional(),
        cover_photo_url: z.string().url().nullable().optional(),
        use_cover_as_preview: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        const list = await client.createWishlist({
          name: input.name,
          type: listTypeIds[input.type],
          isPrivate: input.private,
          publicView: input.public_view,
          guest: input.guest_claiming,
          allowReactions: input.allow_reactions,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.recipient_id !== undefined
            ? { recipientId: input.recipient_id }
            : {}),
          ...(input.claim_code !== undefined ? { code: input.claim_code } : {}),
          ...(input.cover_photo_url !== undefined
            ? { coverPhoto: input.cover_photo_url }
            : {}),
          useCoverAsPreview: input.use_cover_as_preview,
        });
        return jsonResult({ list });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_update_list",
    {
      title: "Update a Giftful list",
      description:
        "Patch a list's title, type, description, date, privacy, guest access, reactions, recipient, claim code, or cover. Omitted values remain unchanged.",
      inputSchema: {
        slug: z.string().min(1),
        name: z.string().min(1).optional(),
        type: listTypeSchema.optional(),
        description: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        private: z.boolean().optional(),
        public_view: z.boolean().optional(),
        guest_claiming: z.boolean().optional(),
        allow_reactions: z.boolean().optional(),
        recipient_id: z.number().int().positive().optional(),
        claim_code: z.string().nullable().optional(),
        cover_photo_url: z.string().url().nullable().optional(),
        use_cover_as_preview: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        const list = await client.updateWishlist(input.slug, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined
            ? { type: listTypeIds[input.type] }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.private !== undefined ? { isPrivate: input.private } : {}),
          ...(input.public_view !== undefined
            ? { publicView: input.public_view }
            : {}),
          ...(input.guest_claiming !== undefined
            ? { guest: input.guest_claiming }
            : {}),
          ...(input.allow_reactions !== undefined
            ? { allowReactions: input.allow_reactions }
            : {}),
          ...(input.recipient_id !== undefined
            ? { recipientId: input.recipient_id }
            : {}),
          ...(input.claim_code !== undefined ? { code: input.claim_code } : {}),
          ...(input.cover_photo_url !== undefined
            ? { coverPhoto: input.cover_photo_url }
            : {}),
          ...(input.use_cover_as_preview !== undefined
            ? { useCoverAsPreview: input.use_cover_as_preview }
            : {}),
        });
        return jsonResult({ list });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_delete_list",
    {
      title: "Delete a Giftful list",
      description:
        "Soft-delete a list and all its wishes. Giftful keeps deleted lists recoverable in account settings.",
      inputSchema: {
        slug: z.string().min(1),
        confirm: z.boolean().describe("Must be true to delete the list."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, confirm }) => {
      try {
        requireConfirmation(confirm, `delete the list ${slug}`);
        return jsonResult({ deleted: await client.deleteWishlist(slug) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_list_wishes",
    {
      title: "List wishes",
      description:
        "List wishes on a Giftful list, including item IDs used by edit and delete tools.",
      inputSchema: {
        slug: z.string().min(1),
        page: z.number().int().positive().optional().default(1),
        per_page: z.number().int().min(1).max(100).optional().default(100),
        sort_by: z
          .enum([
            "Default",
            "DateAddedAsc",
            "DateAddedDesc",
            "Name",
            "PriceAsc",
            "PriceDesc",
            "Store",
          ])
          .optional()
          .default("Default"),
        claim_code: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ slug, page, per_page, sort_by, claim_code }) => {
      try {
        const wishes = await client.listWishes(slug, {
          page,
          perPage: per_page,
          sortBy: sort_by,
          ...(claim_code !== undefined ? { code: claim_code } : {}),
        });
        return jsonResult({ wishes, page, per_page });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_add_wish",
    {
      title: "Add a wish",
      description:
        "Add a wish manually or from a product URL. If name, price, or image are omitted, Giftful's own scraper is used to fill them when possible.",
      inputSchema: {
        list_slug: z.string().min(1),
        name: z.string().min(1).optional(),
        url: z.string().url().optional(),
        price: z.string().nullable().optional(),
        image_url: z.string().url().nullable().optional(),
        details: z.string().nullable().optional(),
        quantity: z.number().int().min(1).optional().default(1),
        most_desired: z.boolean().optional().default(false),
        category_id: z.number().int().positive().nullable().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        if (!input.name && !input.url)
          throw new Error("Provide at least name or url.");
        const list = await client.getWishlist(input.list_slug);
        let scraped: ScrapedProduct | undefined;
        if (input.url) {
          try {
            scraped = await client.scrapeProduct(input.url);
          } catch (error) {
            // A supplied title is enough to create the wish even when a shop blocks scraping.
            if (!input.name) throw error;
          }
        }
        const name = input.name ?? scraped?.title?.trim();
        if (!name)
          throw new Error(
            "Giftful could not determine a name; provide name explicitly.",
          );
        const scrapedImages =
          scraped?.images ?? (scraped?.image ? [scraped.image] : []);
        const wish = await client.createWish({
          wishlistId: list.id,
          name,
          quantity: input.quantity,
          price:
            input.price === undefined
              ? scraped?.price == null
                ? null
                : String(scraped.price)
              : input.price,
          url: input.url ?? scraped?.url ?? null,
          image:
            input.image_url === undefined
              ? (scrapedImages[0] ?? null)
              : input.image_url,
          details:
            input.details === undefined
              ? (scraped?.description ?? null)
              : input.details,
          desired: input.most_desired,
          dynamicPricing: Boolean(input.url),
          ...(input.category_id !== undefined
            ? { categoryId: input.category_id }
            : {}),
        });
        return jsonResult({ wish, scraped: Boolean(scraped) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_update_wish",
    {
      title: "Update a wish",
      description:
        "Patch an existing wish. Omitted values remain unchanged; null clears nullable fields.",
      inputSchema: {
        list_slug: z.string().min(1),
        wish_id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        url: z.string().url().nullable().optional(),
        price: z.string().nullable().optional(),
        image_url: z.string().url().nullable().optional(),
        details: z.string().nullable().optional(),
        quantity: z.number().int().min(1).optional(),
        most_desired: z.boolean().optional(),
        category_id: z.number().int().positive().nullable().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        const wish = await client.updateWish(input.list_slug, input.wish_id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.image_url !== undefined ? { image: input.image_url } : {}),
          ...(input.details !== undefined ? { details: input.details } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          ...(input.most_desired !== undefined
            ? { desired: input.most_desired }
            : {}),
          ...(input.category_id !== undefined
            ? { categoryId: input.category_id }
            : {}),
        });
        return jsonResult({ wish });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_delete_wish",
    {
      title: "Delete a wish",
      description: "Permanently delete one wish from a list.",
      inputSchema: {
        list_slug: z.string().min(1),
        wish_id: z.number().int().positive(),
        confirm: z.boolean().describe("Must be true to delete the wish."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ list_slug, wish_id, confirm }) => {
      try {
        requireConfirmation(confirm, `delete wish ${wish_id}`);
        return jsonResult({
          deleted: await client.deleteWish(list_slug, wish_id),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_reorder_wish",
    {
      title: "Reorder a wish",
      description:
        "Update the list-wide relative wish order by moving one wish immediately after another. Omit or set after_wish_id=null to move it to the beginning. When Giftful groups wishes by category, category order takes precedence and this relative order controls placement within each category; use an after_wish_id from the same category for a predictable visible result.",
      inputSchema: {
        list_slug: z.string().min(1),
        wish_id: z.number().int().positive(),
        after_wish_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .default(null),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ list_slug, wish_id, after_wish_id }) => {
      try {
        return jsonResult({
          reordered: await client.reorderWish(
            list_slug,
            wish_id,
            after_wish_id,
          ),
          after_wish_id,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_create_category",
    {
      title: "Create a list category",
      description: "Create a category inside a Giftful list.",
      inputSchema: { list_slug: z.string().min(1), name: z.string().min(1) },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ list_slug, name }) => {
      try {
        return jsonResult({
          category: await client.createCategory(list_slug, name),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_claim_wish",
    {
      title: "Claim a Giftful wish",
      description:
        "Reserve a wish so other Giftful users know it is being handled. This changes Giftful state but does not buy the item from a retailer.",
      inputSchema: {
        wish_id: z.number().int().positive(),
        confirm: z
          .boolean()
          .describe(
            "Must be true to reserve the wish for the authenticated user.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ wish_id, confirm }) => {
      try {
        requireConfirmation(confirm, `claim wish ${wish_id}`);
        return jsonResult({ claimed: await client.claimWish(wish_id) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_unclaim_wish",
    {
      title: "Unclaim a Giftful wish",
      description:
        "Release the authenticated user's existing Giftful reservation so someone else may claim or purchase the wish.",
      inputSchema: {
        wish_id: z.number().int().positive(),
        confirm: z
          .boolean()
          .describe("Must be true to release the existing reservation."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ wish_id, confirm }) => {
      try {
        requireConfirmation(confirm, `unclaim wish ${wish_id}`);
        return jsonResult({ unclaimed: await client.unclaimWish(wish_id) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_delete_category",
    {
      title: "Delete a list category",
      description:
        "Delete a category. Wishes in it remain on the list without that category.",
      inputSchema: {
        list_slug: z.string().min(1),
        category_id: z.number().int().positive(),
        confirm: z.boolean(),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ list_slug, category_id, confirm }) => {
      try {
        requireConfirmation(confirm, `delete category ${category_id}`);
        return jsonResult({
          deleted: await client.deleteCategory(list_slug, category_id),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "giftful_reorder_categories",
    {
      title: "Reorder list categories",
      description:
        "Persist the primary display order of categories for an owned list. category_ids must contain every category ID from giftful_get_list exactly once, in the desired order. Wishes retain their list-wide relative order within each category.",
      inputSchema: {
        list_slug: z.string().min(1),
        category_ids: z.array(z.number().int().positive()).max(1000),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ list_slug, category_ids }) => {
      try {
        return jsonResult({
          categories: await client.reorderCategories(list_slug, category_ids),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return { server, client };
}
