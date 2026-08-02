import type { CredentialStore } from "../auth/storage.js";
import * as operations from "./operations.js";
import type {
  AuthRecord,
  FollowRelationship,
  FollowStatusName,
  FriendWishlist,
  GiftfulUser,
  GraphQLResponse,
  LoginResponse,
  RefreshResponse,
  RefreshToken,
  ResponseMessage,
  ScrapedProduct,
  Wish,
  Wishlist,
  WishlistCategory,
} from "./types.js";

const DEFAULT_GRAPHQL_URL = "https://api.giftful.com/graphql";
const DEFAULT_LINK_URL = "https://link.giftful.com";
const WISH_LOOKUP_PAGE_SIZE = 100;
const MAX_WISH_LOOKUP_PAGES = 20;

const LOGIN_INSTRUCTIONS = {
  browser:
    "Run `giftful-auth login-browser` (source checkout: `npm run auth -- login-browser`).",
  password:
    "Run `giftful-auth login USERNAME` (source checkout: `npm run auth -- login USERNAME`). The password is prompted without echoing.",
} as const;

export class GiftfulApiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "graphql" | "http" | "network" | "validation",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GiftfulApiError";
  }
}

export class GiftfulAuthRequiredError extends GiftfulApiError {
  constructor(
    message = "Giftful login required. Run `giftful-auth login-browser` or `giftful-auth login USERNAME` (from source: `npm run auth -- login-browser` or `npm run auth -- login USERNAME`).",
  ) {
    super(message, "auth");
    this.name = "GiftfulAuthRequiredError";
  }
}

export interface GiftfulClientOptions {
  graphqlUrl?: string;
  linkUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface CreateWishlistInput {
  name: string;
  type?: 1 | 2 | 3;
  isPrivate?: boolean;
  allowReactions?: boolean;
  publicView?: boolean;
  guest?: boolean;
  recipientId?: number;
  date?: string | null;
  description?: string | null;
  code?: string | null;
  coverPhoto?: string | null;
  useCoverAsPreview?: boolean;
}

export interface UpdateWishlistInput {
  name?: string;
  type?: 1 | 2 | 3;
  isPrivate?: boolean;
  allowReactions?: boolean;
  publicView?: boolean;
  guest?: boolean;
  recipientId?: number;
  date?: string | null;
  description?: string | null;
  code?: string | null;
  coverPhoto?: string | null;
  useCoverAsPreview?: boolean;
}

export interface CreateWishInput {
  wishlistId: number;
  name: string;
  quantity?: number;
  price?: string | null;
  url?: string | null;
  image?: string | null;
  desired?: boolean;
  details?: string | null;
  dynamicPricing?: boolean;
  categoryId?: number | null;
}

export interface UpdateWishInput {
  name?: string;
  quantity?: number;
  price?: string | null;
  url?: string | null;
  image?: string | null;
  desired?: boolean;
  details?: string | null;
  categoryId?: number | null;
}

function isAuthMessage(message: string): boolean {
  return /invalid token|unauthenticated|unauthorized|not authorized|jwt|token expired/i.test(
    message,
  );
}

function accessTokenExpiresSoon(token: string, leewaySeconds = 30): boolean {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return true;
    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as {
      exp?: number;
    };
    return (
      typeof payload.exp !== "number" ||
      Date.now() >= (payload.exp - leewaySeconds) * 1000
    );
  } catch {
    return true;
  }
}

function cleanVariables<T extends Record<string, unknown>>(variables: T): T {
  return Object.fromEntries(
    Object.entries(variables).filter(([, value]) => value !== undefined),
  ) as T;
}

function followStatusName(status: number): FollowStatusName {
  switch (status) {
    case -2:
      return "unfollowed";
    case -1:
      return "rejected";
    case 0:
      return "pending";
    case 1:
      return "active";
    default:
      return "unknown";
  }
}

function normalizeFollowRelationship(
  relationship: FollowRelationship,
): FollowRelationship {
  return {
    ...relationship,
    statusName: followStatusName(relationship.status),
  };
}

export class GiftfulClient {
  private readonly graphqlUrl: string;
  private readonly linkUrl: string;
  private readonly fetchImpl: typeof fetch;
  private record: AuthRecord | null | undefined;
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly store: CredentialStore,
    options: GiftfulClientOptions = {},
  ) {
    this.graphqlUrl =
      options.graphqlUrl ??
      process.env.GIFTFUL_GRAPHQL_URL ??
      DEFAULT_GRAPHQL_URL;
    this.linkUrl =
      options.linkUrl ?? process.env.GIFTFUL_LINK_URL ?? DEFAULT_LINK_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  storageDescription(): string {
    return this.store.description();
  }

  private async loadRecord(): Promise<AuthRecord | null> {
    if (this.record === undefined) this.record = await this.store.load();
    return this.record;
  }

  async authStatus(validate = false): Promise<{
    authenticated: boolean;
    username: string | null;
    storage: string;
    validated: boolean;
    login?: typeof LOGIN_INSTRUCTIONS;
  }> {
    const record = await this.loadRecord();
    if (!record) {
      return {
        authenticated: false,
        username: null,
        storage: this.storageDescription(),
        validated: false,
        login: LOGIN_INSTRUCTIONS,
      };
    }
    if (validate) await this.ensureAccessToken(true);
    return {
      authenticated: true,
      username: (this.record?.user ?? record.user).username,
      storage: this.storageDescription(),
      validated: validate,
    };
  }

  async login(username: string, password: string): Promise<GiftfulUser> {
    const data = await this.rawGraphql<{ login: LoginResponse }>(
      operations.LOGIN,
      { username, password },
      undefined,
    );
    const login = data.login;
    if (!login?.accessToken || !login.refreshToken?.token || !login.user) {
      throw new GiftfulApiError(
        "Giftful returned an incomplete login response.",
        "auth",
      );
    }

    const record: AuthRecord = {
      schemaVersion: 1,
      refreshToken: login.refreshToken,
      user: login.user,
    };
    await this.store.save(record);
    this.record = record;
    this.accessToken = login.accessToken;
    return login.user;
  }

  async importRefreshToken(refreshToken: RefreshToken): Promise<GiftfulUser> {
    if (
      !Number.isSafeInteger(refreshToken.id) ||
      typeof refreshToken.token !== "string" ||
      refreshToken.token.length === 0
    ) {
      throw new GiftfulApiError(
        "The captured Giftful refresh credential is invalid.",
        "auth",
      );
    }

    const data = await this.rawGraphql<{ refreshToken: RefreshResponse }>(
      operations.REFRESH_TOKEN,
      { id: refreshToken.id, token: refreshToken.token },
      undefined,
    );
    if (!data.refreshToken?.accessToken || !data.refreshToken.user) {
      throw new GiftfulApiError(
        "Giftful rejected the captured browser session.",
        "auth",
      );
    }

    const record: AuthRecord = {
      schemaVersion: 1,
      refreshToken,
      user: data.refreshToken.user,
    };
    await this.store.save(record);
    this.record = record;
    this.accessToken = data.refreshToken.accessToken;
    return data.refreshToken.user;
  }

  async logout(): Promise<void> {
    const record = await this.loadRecord();
    try {
      if (record) {
        const token = await this.ensureAccessToken().catch(() => undefined);
        if (token) {
          await this.rawGraphql<{ logout: ResponseMessage }>(
            operations.LOGOUT,
            { refreshTokenId: record.refreshToken.id },
            token,
          ).catch(() => undefined);
        }
      }
    } finally {
      await this.store.clear();
      this.record = null;
      this.accessToken = null;
    }
  }

  private async ensureAccessToken(force = false): Promise<string> {
    if (
      !force &&
      this.accessToken &&
      !accessTokenExpiresSoon(this.accessToken)
    ) {
      return this.accessToken;
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshAccessToken(): Promise<string> {
    const record = await this.loadRecord();
    if (!record) throw new GiftfulAuthRequiredError();

    try {
      const data = await this.rawGraphql<{ refreshToken: RefreshResponse }>(
        operations.REFRESH_TOKEN,
        { id: record.refreshToken.id, token: record.refreshToken.token },
        undefined,
      );
      if (!data.refreshToken?.accessToken || !data.refreshToken.user) {
        throw new GiftfulApiError(
          "Giftful returned an incomplete token refresh response.",
          "auth",
        );
      }
      this.accessToken = data.refreshToken.accessToken;
      this.record = { ...record, user: data.refreshToken.user };
      await this.store.save(this.record);
      return this.accessToken;
    } catch (error) {
      if (error instanceof GiftfulApiError && error.kind === "auth") {
        await this.store.clear().catch(() => undefined);
        this.record = null;
        this.accessToken = null;
        throw new GiftfulAuthRequiredError(
          "Giftful rejected the saved session. Run `giftful-auth login-browser` or `giftful-auth login USERNAME` again (use the equivalent `npm run auth -- ...` command from a source checkout).",
        );
      }
      throw error;
    }
  }

  private async rawGraphql<T>(
    query: string,
    variables: Record<string, unknown>,
    accessToken?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.graphqlUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ query, variables: cleanVariables(variables) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new GiftfulApiError(
        `Unable to reach Giftful: ${error instanceof Error ? error.message : String(error)}`,
        "network",
      );
    }

    let payload: GraphQLResponse<T>;
    try {
      payload = (await response.json()) as GraphQLResponse<T>;
    } catch {
      throw new GiftfulApiError(
        `Giftful returned HTTP ${response.status} with a non-JSON response.`,
        "http",
        response.status,
      );
    }

    if (!response.ok) {
      const message =
        payload.errors?.map((error) => error.message).join("; ") ||
        response.statusText;
      throw new GiftfulApiError(
        `Giftful returned HTTP ${response.status}: ${message}`,
        isAuthMessage(message) ? "auth" : "http",
        response.status,
      );
    }
    if (payload.errors?.length) {
      const message = payload.errors.map((error) => error.message).join("; ");
      throw new GiftfulApiError(
        message,
        isAuthMessage(message) ? "auth" : "graphql",
      );
    }
    if (!payload.data) {
      throw new GiftfulApiError("Giftful returned no data.", "graphql");
    }
    return payload.data;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const token = await this.ensureAccessToken();
    try {
      return await this.rawGraphql<T>(query, variables, token);
    } catch (error) {
      if (error instanceof GiftfulApiError && error.kind === "auth") {
        const refreshed = await this.ensureAccessToken(true);
        return this.rawGraphql<T>(query, variables, refreshed);
      }
      throw error;
    }
  }

  private async currentUser(): Promise<GiftfulUser> {
    await this.ensureAccessToken();
    const record = await this.loadRecord();
    if (!record) throw new GiftfulAuthRequiredError();
    return record.user;
  }

  async listWishlists(): Promise<Wishlist[]> {
    const user = await this.currentUser();
    const data = await this.graphql<{ wishlists: Wishlist[] }>(
      operations.LIST_WISHLISTS,
      {
        username: user.username,
      },
    );
    return data.wishlists;
  }

  async listFriendWishlists(
    options: { page?: number; perPage?: number } = {},
  ): Promise<FriendWishlist[]> {
    const data = await this.graphql<{
      followingWishlists: FriendWishlist[];
    }>(operations.LIST_FRIEND_WISHLISTS, {
      page: options.page ?? 1,
      perPage: options.perPage ?? 100,
    });
    return data.followingWishlists;
  }

  async listFollowers(
    options: { page?: number; perPage?: number } = {},
  ): Promise<FollowRelationship[]> {
    const user = await this.currentUser();
    const data = await this.graphql<{ followers: FollowRelationship[] }>(
      operations.LIST_FOLLOWERS,
      {
        userId: user.id,
        page: options.page ?? 1,
        perPage: options.perPage ?? 100,
      },
    );
    return data.followers.map(normalizeFollowRelationship);
  }

  async listFollowing(
    options: { page?: number; perPage?: number } = {},
  ): Promise<FollowRelationship[]> {
    const user = await this.currentUser();
    const data = await this.graphql<{ following: FollowRelationship[] }>(
      operations.LIST_FOLLOWING,
      {
        userId: user.id,
        active: true,
        page: options.page ?? 1,
        perPage: options.perPage ?? 100,
      },
    );
    return data.following.map(normalizeFollowRelationship);
  }

  async getWishlist(slug: string): Promise<Wishlist> {
    const data = await this.graphql<{ wishlist: Wishlist | null }>(
      operations.GET_WISHLIST,
      {
        slug,
      },
    );
    if (!data.wishlist)
      throw new GiftfulApiError(`Wishlist not found: ${slug}`, "validation");
    return data.wishlist;
  }

  async createWishlist(input: CreateWishlistInput): Promise<Wishlist> {
    const user = await this.currentUser();
    const data = await this.graphql<{ createWishlist: Wishlist }>(
      operations.CREATE_WISHLIST,
      {
        name: input.name.trim(),
        type: input.type ?? 1,
        isPrivate: input.isPrivate ?? false,
        allowReactions: input.allowReactions ?? true,
        publicView: input.publicView ?? true,
        guest: input.guest ?? true,
        recipientId: input.recipientId ?? user.id,
        date: input.date ?? null,
        description: input.description?.trim() ?? null,
        collaborators: [],
        block: [],
        code: input.code ?? null,
        coverPhoto: input.coverPhoto ?? null,
        useCoverAsPreview: input.useCoverAsPreview ?? false,
      },
    );
    return data.createWishlist;
  }

  async updateWishlist(
    slug: string,
    patch: UpdateWishlistInput,
  ): Promise<Wishlist> {
    const current = await this.getWishlist(slug);
    const blockData = await this.graphql<{
      wishlistBlock: Array<{ userId: number }>;
    }>(operations.GET_WISHLIST_BLOCK, { wishlistId: current.id });
    const collaborators = (current.collaborators ?? []).map(
      (entry) => entry.userId,
    );
    const blocked = (blockData.wishlistBlock ?? []).map(
      (entry) => entry.userId,
    );
    const data = await this.graphql<{ updateWishlist: Wishlist }>(
      operations.UPDATE_WISHLIST,
      {
        wishlistId: current.id,
        name: patch.name?.trim() ?? current.name,
        type: patch.type ?? current.type,
        isPrivate: patch.isPrivate ?? current.isPrivate,
        allowReactions: patch.allowReactions ?? current.allowReactions,
        publicView: patch.publicView ?? current.publicView,
        guest: patch.guest ?? current.guest,
        recipientId: patch.recipientId ?? current.recipientId,
        date: patch.date === undefined ? (current.date ?? null) : patch.date,
        description:
          patch.description === undefined
            ? (current.description ?? null)
            : (patch.description?.trim() ?? null),
        collaborators,
        block: blocked,
        code: patch.code === undefined ? (current.code ?? null) : patch.code,
        coverPhoto:
          patch.coverPhoto === undefined
            ? (current.media?.coverPhoto ?? null)
            : patch.coverPhoto,
        useCoverAsPreview:
          patch.useCoverAsPreview ?? current.media?.useCoverAsPreview ?? false,
      },
    );
    return data.updateWishlist;
  }

  async deleteWishlist(slug: string): Promise<ResponseMessage> {
    const user = await this.currentUser();
    const list = await this.getWishlist(slug);
    if (list.userId !== user.id) {
      throw new GiftfulApiError(
        "Only the owner can delete this wishlist.",
        "validation",
      );
    }
    const data = await this.graphql<{ deleteWishlist: ResponseMessage }>(
      operations.DELETE_WISHLIST,
      {
        slug,
        userId: user.id,
      },
    );
    return data.deleteWishlist;
  }

  async listWishes(
    slug: string,
    options: {
      page?: number;
      perPage?: number;
      sortBy?: string;
      code?: string;
    } = {},
  ): Promise<Wish[]> {
    const data = await this.graphql<{ wishes: Wish[] }>(
      operations.LIST_WISHES,
      {
        slug,
        page: options.page ?? 1,
        perPage: options.perPage ?? 100,
        sortBy: options.sortBy ?? "Default",
        code: options.code,
      },
    );
    return data.wishes;
  }

  async createWish(input: CreateWishInput): Promise<Wish> {
    const data = await this.graphql<{ createWish: Wish }>(
      operations.CREATE_WISH,
      {
        wishlistId: input.wishlistId,
        name: input.name.trim(),
        quantity: input.quantity ?? 1,
        price: input.price ?? null,
        url: input.url ?? null,
        image: input.image ?? null,
        desired: input.desired ?? false,
        details: input.details?.trim() ?? null,
        dynamicPricing: input.dynamicPricing ?? Boolean(input.url),
        categoryId: input.categoryId ?? null,
      },
    );
    return data.createWish;
  }

  async updateWish(
    wishlistSlug: string,
    wishId: number,
    patch: UpdateWishInput,
  ): Promise<Wish> {
    const wishlist = await this.getWishlist(wishlistSlug);
    let current: Wish | undefined;
    let reachedLookupLimit = true;
    for (let page = 1; page <= MAX_WISH_LOOKUP_PAGES; page += 1) {
      const wishes = await this.listWishes(wishlistSlug, {
        page,
        perPage: WISH_LOOKUP_PAGE_SIZE,
      });
      current = wishes.find((wish) => wish.id === wishId);
      if (current) break;
      if (wishes.length < WISH_LOOKUP_PAGE_SIZE) {
        reachedLookupLimit = false;
        break;
      }
    }
    if (!current) {
      throw new GiftfulApiError(
        reachedLookupLimit
          ? `Wish ${wishId} was not found within the first ${MAX_WISH_LOOKUP_PAGES * WISH_LOOKUP_PAGE_SIZE} wishes on ${wishlistSlug}; refusing to make more lookup requests.`
          : `Wish ${wishId} was not found on ${wishlistSlug}.`,
        "validation",
      );
    }
    const data = await this.graphql<{ updateWish: Wish }>(
      operations.UPDATE_WISH,
      {
        wishlistId: wishlist.id,
        wishId,
        name: patch.name?.trim() ?? current.name,
        quantity: patch.quantity ?? current.quantity,
        price:
          patch.price === undefined ? (current.price ?? null) : patch.price,
        url: patch.url === undefined ? (current.url ?? null) : patch.url,
        image:
          patch.image === undefined ? (current.image ?? null) : patch.image,
        desired: patch.desired ?? current.desired ?? false,
        details:
          patch.details === undefined
            ? (current.details ?? null)
            : (patch.details?.trim() ?? null),
        categoryId:
          patch.categoryId === undefined
            ? (current.categoryId ?? null)
            : patch.categoryId,
      },
    );
    return data.updateWish;
  }

  async deleteWish(
    wishlistSlug: string,
    wishId: number,
  ): Promise<ResponseMessage> {
    const wishlist = await this.getWishlist(wishlistSlug);
    const data = await this.graphql<{ deleteWish: ResponseMessage }>(
      operations.DELETE_WISH,
      {
        wishId,
        wishlistId: wishlist.id,
      },
    );
    return data.deleteWish;
  }

  async claimWish(wishId: number): Promise<Wish> {
    const data = await this.graphql<{ claim: Wish }>(operations.CLAIM_WISH, {
      wishId,
    });
    return data.claim;
  }

  async unclaimWish(wishId: number): Promise<Wish> {
    const data = await this.graphql<{ unclaim: Wish }>(
      operations.UNCLAIM_WISH,
      { wishId },
    );
    return data.unclaim;
  }

  async createCategory(
    wishlistSlug: string,
    name: string,
  ): Promise<WishlistCategory> {
    const wishlist = await this.getWishlist(wishlistSlug);
    const data = await this.graphql<{
      createWishlistCategory: WishlistCategory;
    }>(operations.CREATE_CATEGORY, {
      wishlistId: wishlist.id,
      name: name.trim(),
    });
    return data.createWishlistCategory;
  }

  async deleteCategory(
    wishlistSlug: string,
    categoryId: number,
  ): Promise<boolean> {
    const wishlist = await this.getWishlist(wishlistSlug);
    const data = await this.graphql<{ deleteWishlistCategory: boolean }>(
      operations.DELETE_CATEGORY,
      { id: categoryId, wishlistId: wishlist.id },
    );
    return data.deleteWishlistCategory;
  }

  async scrapeProduct(url: string): Promise<ScrapedProduct> {
    const parsed = new URL(url);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
      throw new GiftfulApiError(
        "Product URL must use http or https.",
        "validation",
      );
    }
    const token = await this.ensureAccessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.linkUrl}/scrapers/html`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url, output: "parsed" }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new GiftfulApiError(
        `Unable to scrape product details: ${error instanceof Error ? error.message : String(error)}`,
        "network",
      );
    }
    if (!response.ok) {
      throw new GiftfulApiError(
        `Giftful product scraper returned HTTP ${response.status}.`,
        response.status === 401 ? "auth" : "http",
        response.status,
      );
    }
    return (await response.json()) as ScrapedProduct;
  }
}
