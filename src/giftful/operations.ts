export const USER_FIELDS = `
  id
  username
  firstName
  lastName
  email
  avatar
  isPrivate
  currency
  roleId
  verified
`;

export const PUBLIC_USER_FIELDS = `
  id
  username
  firstName
  lastName
  avatar
  isPrivate
  verified
`;

export const WISHLIST_FIELDS = `
  id
  userId
  slug
  name
  date
  description
  isPrivate
  type
  recipientId
  collaborate
  publicView
  guest
  code
  wishCount
  allowReactions
  createdAt
  updatedAt
  media
  collaborators {
    id
    userId
    status
    user { ${USER_FIELDS} }
  }
`;

export const WISH_FIELDS = `
  id
  name
  price
  desired
  image
  acceptedBy
  acceptedOn
  completed
  createdAt
  details
  quantity
  received
  url
  productId
  userId
  wishlistId
  categoryId
  sortOrder
  dynamicPricing
  brand { name icon domain }
`;

export const LOGIN = `
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      accessToken
      refreshToken { id token }
      user { ${USER_FIELDS} }
    }
  }
`;

export const REFRESH_TOKEN = `
  mutation RefreshToken($id: Int!, $token: String!) {
    refreshToken(id: $id, token: $token) {
      accessToken
      user { ${USER_FIELDS} }
    }
  }
`;

export const LOGOUT = `
  mutation Logout($refreshTokenId: Int!) {
    logout(refreshTokenId: $refreshTokenId) { id message }
  }
`;

export const LIST_WISHLISTS = `
  query Wishlists($username: String!) {
    wishlists(username: $username) { ${WISHLIST_FIELDS} }
  }
`;

export const LIST_FRIEND_WISHLISTS = `
  query FollowingWishlists($page: Int!, $perPage: Int!) {
    followingWishlists(page: $page, perPage: $perPage) {
      id
      userId
      slug
      name
      date
      isPrivate
      wishCount
      latestWishes
      media
      user { ${PUBLIC_USER_FIELDS} }
    }
  }
`;

export const LIST_FOLLOWERS = `
  query Followers($userId: Int!, $page: Int!, $perPage: Int!) {
    followers(userId: $userId, page: $page, perPage: $perPage) {
      id
      userId
      followerId
      claimed
      status
      createdAt
      follower { ${PUBLIC_USER_FIELDS} }
    }
  }
`;

export const LIST_FOLLOWING = `
  query Following(
    $userId: Int!
    $active: Boolean
    $page: Int!
    $perPage: Int!
  ) {
    following(
      userId: $userId
      active: $active
      page: $page
      perPage: $perPage
    ) {
      id
      userId
      followerId
      claimed
      status
      user { ${PUBLIC_USER_FIELDS} }
    }
  }
`;

export const GET_WISHLIST = `
  query Wishlist($slug: String!) {
    wishlist(slug: $slug) {
      ${WISHLIST_FIELDS}
      categories {
        id
        wishlistId
        name
        sortOrder
        wishCount
      }
      user { ${USER_FIELDS} }
    }
  }
`;

export const GET_WISHLIST_BLOCK = `
  query WishlistBlock($wishlistId: Int!) {
    wishlistBlock(wishlistId: $wishlistId) { userId }
  }
`;

export const CREATE_WISHLIST = `
  mutation CreateWishlist(
    $name: String!
    $type: Int!
    $isPrivate: Boolean!
    $allowReactions: Boolean!
    $publicView: Boolean!
    $guest: Boolean!
    $recipientId: Int!
    $date: String
    $description: String
    $collaborators: [Int!]
    $block: [Int!]
    $code: String
    $coverPhoto: String
    $useCoverAsPreview: Boolean!
  ) {
    createWishlist(
      name: $name
      type: $type
      isPrivate: $isPrivate
      allowReactions: $allowReactions
      publicView: $publicView
      guest: $guest
      recipientId: $recipientId
      date: $date
      description: $description
      collaborators: $collaborators
      block: $block
      code: $code
      coverPhoto: $coverPhoto
      useCoverAsPreview: $useCoverAsPreview
    ) { ${WISHLIST_FIELDS} }
  }
`;

export const UPDATE_WISHLIST = `
  mutation UpdateWishlist(
    $wishlistId: Int!
    $name: String!
    $type: Int!
    $isPrivate: Boolean!
    $allowReactions: Boolean!
    $publicView: Boolean!
    $guest: Boolean!
    $recipientId: Int!
    $date: String
    $description: String
    $collaborators: [Int!]
    $block: [Int!]
    $code: String
    $coverPhoto: String
    $useCoverAsPreview: Boolean!
  ) {
    updateWishlist(
      wishlistId: $wishlistId
      name: $name
      type: $type
      isPrivate: $isPrivate
      allowReactions: $allowReactions
      publicView: $publicView
      guest: $guest
      recipientId: $recipientId
      date: $date
      description: $description
      collaborators: $collaborators
      block: $block
      code: $code
      coverPhoto: $coverPhoto
      useCoverAsPreview: $useCoverAsPreview
    ) { ${WISHLIST_FIELDS} }
  }
`;

export const DELETE_WISHLIST = `
  mutation DeleteWishlist($slug: String!, $userId: Int!) {
    deleteWishlist(slug: $slug, userId: $userId) {
      id
      message
      reference
    }
  }
`;

export const LIST_WISHES = `
  query Wishes(
    $slug: String!
    $page: Int!
    $perPage: Int!
    $sortBy: WishlistSortType
    $code: String
  ) {
    wishes(
      wishlistSlug: $slug
      page: $page
      perPage: $perPage
      sortBy: $sortBy
      code: $code
    ) { ${WISH_FIELDS} }
  }
`;

export const CREATE_WISH = `
  mutation CreateWish(
    $wishlistId: Int!
    $name: String!
    $quantity: Int!
    $price: String
    $url: String
    $image: String
    $desired: Boolean
    $details: String
    $dynamicPricing: Boolean
    $categoryId: Int
  ) {
    createWish(
      wishlistId: $wishlistId
      name: $name
      quantity: $quantity
      price: $price
      url: $url
      image: $image
      desired: $desired
      details: $details
      dynamicPricing: $dynamicPricing
      categoryId: $categoryId
    ) { ${WISH_FIELDS} }
  }
`;

export const UPDATE_WISH = `
  mutation UpdateWish(
    $wishlistId: Int!
    $wishId: Int
    $name: String!
    $quantity: Int!
    $price: String
    $url: String
    $image: String
    $desired: Boolean
    $details: String
    $categoryId: Int
  ) {
    updateWish(
      wishlistId: $wishlistId
      id: $wishId
      name: $name
      quantity: $quantity
      price: $price
      url: $url
      image: $image
      desired: $desired
      details: $details
      categoryId: $categoryId
    ) { ${WISH_FIELDS} }
  }
`;

export const UPDATE_WISH_SORT_ORDER = `
  mutation UpdateWishSortOrder($wishId: Int!, $prevWishId: Int) {
    updateWishSortOrder(wishId: $wishId, prevWishId: $prevWishId) {
      id
    }
  }
`;

export const DELETE_WISH = `
  mutation DeleteWish($wishId: Int!, $wishlistId: Int!) {
    deleteWish(id: $wishId, wishlistId: $wishlistId) {
      id
      message
      reference
    }
  }
`;

export const CLAIM_WISH = `
  mutation Claim($wishId: Int!) {
    claim(wishId: $wishId) {
      ${WISH_FIELDS}
      wishlist {
        id
        userId
        slug
        name
        type
        recipientId
      }
    }
  }
`;

export const UNCLAIM_WISH = `
  mutation Unclaim($wishId: Int!) {
    unclaim(wishId: $wishId) {
      ${WISH_FIELDS}
      wishlist {
        id
        userId
        slug
        name
        type
        recipientId
      }
    }
  }
`;

export const CREATE_CATEGORY = `
  mutation CreateWishlistCategory($wishlistId: Int!, $name: String!) {
    createWishlistCategory(wishlistId: $wishlistId, name: $name) {
      id
      wishlistId
      name
      sortOrder
      wishCount
    }
  }
`;

export const DELETE_CATEGORY = `
  mutation DeleteWishlistCategory($id: Int!, $wishlistId: Int!) {
    deleteWishlistCategory(id: $id, wishlistId: $wishlistId)
  }
`;

export const REORDER_WISHLIST_CATEGORIES = `
  mutation ReorderWishlistCategories(
    $wishlistId: Int!
    $categoryIds: [Int!]!
  ) {
    reorderWishlistCategories(
      wishlistId: $wishlistId
      categoryIds: $categoryIds
    ) {
      id
      wishlistId
      name
      sortOrder
      wishCount
    }
  }
`;
