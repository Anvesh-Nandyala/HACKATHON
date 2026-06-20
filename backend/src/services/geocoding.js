const ngeohash = require('ngeohash');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = process.env.GEOCODING_USER_AGENT || 'ReCircle/1.0 contact@recircle.local';

function validCoordinatePair(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

async function geocodeAddress(address) {
  if (!address || !address.trim()) {
    const err = new Error('Pickup address is required');
    err.statusCode = 400;
    throw err;
  }

  if (typeof fetch !== 'function') {
    const err = new Error('Address geocoding is not available in this Node.js runtime');
    err.statusCode = 500;
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({
      q: address.trim(),
      format: 'json',
      limit: '1',
      addressdetails: '1',
    });

    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = new Error('Unable to verify pickup address location');
      err.statusCode = 400;
      throw err;
    }

    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const err = new Error('Pickup address could not be found. Enter a more complete address with city and country.');
      err.statusCode = 400;
      throw err;
    }

    return {
      latitude,
      longitude,
      address: address.trim(),
      geocodedAddress: first.display_name,
      geohash: ngeohash.encode(latitude, longitude, 6),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Pickup address lookup timed out. Try a more complete address.');
      timeoutErr.statusCode = 400;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveProductLocation({ location, pickupAddress }) {
  if (validCoordinatePair(location)) {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    return {
      latitude,
      longitude,
      geohash: location.geohash || ngeohash.encode(latitude, longitude, 6),
      address: pickupAddress?.trim() || location.address || 'Seller pickup address not provided',
      ...(location.city && { city: location.city }),
    };
  }

  return geocodeAddress(pickupAddress);
}

module.exports = {
  geocodeAddress,
  resolveProductLocation,
  validCoordinatePair,
};
