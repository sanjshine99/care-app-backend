const settingsService = require("../settingsService");

function calculateDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function estimateFromDistance(km) {
  const settings = await settingsService.getSchedulingSettings();
  const speedKmh = settings?.travelSpeedKmh ?? 30;
  return Math.ceil((km / speedKmh) * 60);
}

async function calculateTravelTime(coords1, coords2) {
  try {
    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
      return estimateFromDistance(calculateDistance(coords1, coords2));
    }
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords1[0]},${coords1[1]};${coords2[0]},${coords2[1]}?access_token=${mapboxToken}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.routes && data.routes[0]) {
      return Math.ceil(data.routes[0].duration / 60);
    }
    return estimateFromDistance(calculateDistance(coords1, coords2));
  } catch (error) {
    return estimateFromDistance(calculateDistance(coords1, coords2));
  }
}

module.exports = {
  calculateDistance,
  estimateFromDistance,
  calculateTravelTime,
};
