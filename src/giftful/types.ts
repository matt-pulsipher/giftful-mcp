export interface GiftfulUser {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  avatar?: string | null;
  isPrivate?: boolean;
  currency?: string | null;
  roleId?: number;
  verified?: boolean;
}

export interface GiftfulPublicUser {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
  isPrivate?: boolean;
  verified?: boolean;
}

export interface RefreshToken {
  id: number;
  token: string;
}

export interface AuthRecord {
  schemaVersion: 1;
  refreshToken: RefreshToken;
  user: GiftfulUser;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: RefreshToken;
  user: GiftfulUser;
}

export interface RefreshResponse {
  accessToken: string;
  user: GiftfulUser;
}

export interface WishlistMedia {
  coverPhoto?: string | null;
  useCoverAsPreview?: boolean;
  [key: string]: unknown;
}

export interface WishlistCollaborator {
  id: number;
  userId: number;
  status: number;
  user?: GiftfulUser;
}

export interface WishlistCategory {
  id: number;
  wishlistId: number;
  name: string;
  sortOrder?: number;
  wishCount?: number;
}

export interface Wishlist {
  id: number;
  userId: number;
  slug: string;
  name: string;
  date?: string | null;
  description?: string | null;
  isPrivate: boolean;
  type: number;
  recipientId: number;
  collaborate?: boolean;
  collaborators?: WishlistCollaborator[];
  publicView: boolean;
  guest: boolean;
  code?: string | null;
  wishCount?: number;
  allowReactions: boolean;
  createdAt?: string;
  updatedAt?: string;
  media?: WishlistMedia | null;
  categories?: WishlistCategory[];
  user?: GiftfulUser;
}

export interface FriendWishlist {
  id: number;
  userId: number;
  slug: string;
  name: string;
  date?: string | null;
  isPrivate: boolean;
  wishCount?: number;
  latestWishes?: unknown;
  media?: WishlistMedia | null;
  user?: GiftfulPublicUser;
}

export type FollowStatusName =
  | "unfollowed"
  | "rejected"
  | "pending"
  | "active"
  | "unknown";

export interface FollowRelationship {
  id: number;
  userId: number;
  followerId: number;
  claimed?: boolean;
  status: number;
  statusName?: FollowStatusName;
  createdAt?: string;
  user?: GiftfulPublicUser;
  follower?: GiftfulPublicUser;
}

export interface WishBrand {
  name?: string | null;
  icon?: string | null;
  domain?: string | null;
}

export interface Wish {
  id: number;
  name: string;
  price?: string | null;
  desired?: boolean;
  image?: string | null;
  acceptedBy?: number | null;
  acceptedOn?: string | null;
  completed?: boolean;
  createdAt?: string;
  details?: string | null;
  quantity: number;
  received?: boolean;
  url?: string | null;
  productId?: string | null;
  userId: number;
  wishlistId: number;
  categoryId?: number | null;
  dynamicPricing?: boolean;
  brand?: WishBrand | null;
}

export interface ScrapedProduct {
  url: string;
  title?: string | null;
  price?: string | null;
  description?: string | null;
  images?: string[];
  image?: string | null;
  [key: string]: unknown;
}

export interface ResponseMessage {
  id: number;
  message: string;
  reference?: string | null;
}

export interface GraphQLErrorItem {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLErrorItem[];
}
