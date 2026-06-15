const ngeohash = require('ngeohash');
const { store } = require('../db/store');
const { invalidateOnProductChange } = require('./cacheInvalidation');

/**
 * Hyperlocal Marketplace Service.
 * Handles product discovery, reservation, and transactions.
 */

/**
 * Haversine distance calculation between two points (in km).
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

function formatPickupAddress(product) {
  const address = product.pickupAddress || product.location?.address;
  if (address) return address;

  const latitude = product.location?.latitude;
  const longitude = product.location?.longitude;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `Pickup coordinates: ${latitude}, ${longitude}`;
  }

  return 'Seller pickup address not provided';
}

/**
 * Encode a geohash for a location.
 */
function encodeGeohash(latitude, longitude, precision = 6) {
  return ngeohash.encode(latitude, longitude, precision);
}

/**
 * Discover nearby products within a radius.
 */
async function discoverNearby(query) {
  const { q, latitude, longitude, radiusKm = 5, category, priceRange, minCondition, sortBy = 'distance', limit = 20, cursor } = query;

  // Calculate geohash prefix (4 chars for ~20km precision)
  const geohashPrefix = ngeohash.encode(latitude, longitude, 4);
  const adjacentHashes = ngeohash.neighbors(geohashPrefix);
  const searchHashes = [geohashPrefix, ...adjacentHashes];

  // Query products by geohash
  let allProducts = [];
  for (const hash of searchHashes) {
    const products = await store.getProductsByGeohash(hash, { category, priceRange, minCondition });
    allProducts.push(...products);
  }

  // Precise distance filtering and search text filtering
  const qLower = q ? q.toLowerCase() : null;
  const productsWithDistance = allProducts
    .map(product => ({
      ...product,
      distance: haversineDistance(
        latitude, longitude,
        product.location.latitude, product.location.longitude
      ),
    }))
    .filter(p => p.distance <= radiusKm)
    .filter(p => {
      if (!qLower) return true;
      const searchableText = `${p.brand || ''} ${p.model || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase();
      return searchableText.includes(qLower);
    });

  // Sort
  const sorted = sortProducts(productsWithDistance, sortBy);

  // Pagination
  let startIndex = 0;
  if (cursor) {
    startIndex = parseInt(Buffer.from(cursor, 'base64').toString(), 10) || 0;
  }

  const paginated = sorted.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < sorted.length;
  const nextCursor = hasMore
    ? Buffer.from(String(startIndex + limit)).toString('base64')
    : undefined;

  return {
    products: paginated.map(p => ({
      productId: p.productId,
      name: p.brand ? (p.model ? `${p.brand} ${p.model}` : p.brand) : p.category,
      category: p.category,
      brand: p.brand,
      model: p.model,
      condition: p.condition || 'used',
      purchaseDate: p.purchaseDate,
      grade: p.verification?.grade,
      conditionScore: p.verification?.conditionScore,
      originalPrice: p.originalPrice,
      recommendedPrice: p.priceEstimate?.recommendedPrice,
      distance: Math.round(p.distance * 100) / 100,
      location: { latitude: p.location.latitude, longitude: p.location.longitude },
      imageKeys: p.mediaKeys?.images?.slice(0, 3),
      description: p.description,
      createdAt: p.createdAt,
    })),
    nextCursor,
    totalCount: productsWithDistance.length,
  };
}

/**
 * Sort products by specified criterion.
 */
function sortProducts(products, sortBy) {
  switch (sortBy) {
    case 'distance':
      return products.sort((a, b) => a.distance - b.distance);
    case 'price':
      return products.sort((a, b) =>
        (a.priceEstimate?.recommendedPrice || 0) - (b.priceEstimate?.recommendedPrice || 0)
      );
    case 'condition':
      return products.sort((a, b) =>
        (b.verification?.conditionScore || 0) - (a.verification?.conditionScore || 0)
      );
    case 'recency':
      return products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    default:
      return products.sort((a, b) => a.distance - b.distance);
  }
}

/**
 * Reserve a product for pickup (atomic operation).
 */
async function reserveProduct(productId, buyerId, agreedPrice, pickupWindow) {
  const product = await store.getProduct(productId);

  if (!product) {
    const err = new Error('Product not found');
    err.statusCode = 404;
    throw err;
  }

  if (product.status !== 'listed') {
    const err = new Error('Product is not available for reservation');
    err.statusCode = 409;
    throw err;
  }

  if (product.userId === buyerId) {
    const err = new Error('Cannot reserve your own product');
    err.statusCode = 400;
    throw err;
  }

  // Validate price within 80-120% of recommended
  const recommended = product.priceEstimate?.recommendedPrice || 0;
  if (recommended > 0) {
    if (agreedPrice < recommended * 0.8 || agreedPrice > recommended * 1.2) {
      const err = new Error(`Agreed price must be within 80-120% of recommended price ($${recommended})`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate pickup window (1-72 hours)
  const windowStart = new Date(pickupWindow.start);
  const windowEnd = new Date(pickupWindow.end);
  const durationHours = (windowEnd - windowStart) / (1000 * 60 * 60);
  if (durationHours < 1 || durationHours > 72) {
    const err = new Error('Pickup window must be between 1 and 72 hours');
    err.statusCode = 400;
    throw err;
  }

  // Update product status
  product.status = 'reserved';
  await store.saveProduct(product);

  // Invalidate cache for this product
  await invalidateOnProductChange(product);

  // Create transaction
  const { v4: uuidv4 } = require('uuid');
  const seller = await store.getUser(product.userId);
  const pickupOtp = String(Math.floor(100000 + Math.random() * 900000));
  const sellerAddress = formatPickupAddress(product);
  const transaction = {
    transactionId: uuidv4(),
    productId,
    sellerId: product.userId,
    sellerName: seller?.name || 'Seller',
    sellerEmail: seller?.email || '',
    sellerAddress,
    buyerId,
    status: 'reserved',
    agreedPrice,
    pickupLocation: {
      ...product.location,
      address: sellerAddress,
    },
    pickupWindow,
    pickupOtp,
    pickupVerifiedAt: null,
    creditsAwarded: { seller: 0, buyer: 0 },
    createdAt: new Date().toISOString(),
  };

  await store.saveTransaction(transaction);

  return transaction;
}

module.exports = {
  discoverNearby,
  reserveProduct,
  haversineDistance,
  encodeGeohash,
  sortProducts,
};
