export const BUYER_LOCATION_KEY = 'buyer_location';

export const DEFAULT_BUYER_LOCATION = {
  label: 'Your Location',
  address: '',
  latitude: 40.7128,
  longitude: -74.006,
};

export function getBuyerLocation() {
  try {
    const stored = localStorage.getItem(BUYER_LOCATION_KEY);
    if (!stored) return DEFAULT_BUYER_LOCATION;

    const parsed = JSON.parse(stored);
    const latitude = Number(parsed.latitude);
    const longitude = Number(parsed.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return DEFAULT_BUYER_LOCATION;
    }

    return {
      label: parsed.label || parsed.address || 'Saved Location',
      address: parsed.address || '',
      latitude,
      longitude,
    };
  } catch {
    return DEFAULT_BUYER_LOCATION;
  }
}

export function saveBuyerLocation(location) {
  const nextLocation = {
    label: location.label || location.address || 'Saved Location',
    address: location.address || '',
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
  };
  localStorage.setItem(BUYER_LOCATION_KEY, JSON.stringify(nextLocation));
  window.dispatchEvent(new CustomEvent('buyer-location-changed', { detail: nextLocation }));
  return nextLocation;
}
