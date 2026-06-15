export const BUYER_LOCATION_KEY = 'buyer_location';
export const SAVED_ADDRESSES_KEY = 'saved_buyer_addresses';

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

export function getSavedAddresses() {
  try {
    const stored = localStorage.getItem(SAVED_ADDRESSES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addSavedAddress(location) {
  const addresses = getSavedAddresses();
  const nextLocation = {
    id: Date.now().toString(),
    label: location.label || location.address || 'Saved Location',
    address: location.address || '',
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
  };
  // Prevent exact duplicates
  const isDuplicate = addresses.some(a => a.address === nextLocation.address && a.label === nextLocation.label);
  if (!isDuplicate) {
    addresses.push(nextLocation);
    localStorage.setItem(SAVED_ADDRESSES_KEY, JSON.stringify(addresses));
  }
  return addresses;
}

export function clearBuyerData() {
  localStorage.removeItem(BUYER_LOCATION_KEY);
  localStorage.removeItem(SAVED_ADDRESSES_KEY);
}
