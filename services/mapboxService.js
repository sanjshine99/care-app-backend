const axios = require("axios");

const MAPBOX_API_KEY = process.env.MAPBOX_API_KEY;
const MAPBOX_BASE_URL = "https://api.mapbox.com";

/**
 * Geocode an address to get coordinates
 * @param {string} address - Full address string
 * @returns {Promise<Object>} - { longitude, latitude, formattedAddress }
 */
exports.geocodeAddress = async (address) => {
  try {
    if (!MAPBOX_API_KEY) {
      throw new Error("Mapbox API key not configured");
    }

    const response = await axios.get(
      `${MAPBOX_BASE_URL}/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`,
      {
        params: {
          access_token: MAPBOX_API_KEY,
          country: "GB", // UK only
          limit: 1,
        },
      }
    );

    if (!response.data.features || response.data.features.length === 0) {
      throw new Error("Address not found");
    }

    const feature = response.data.features[0];
    const [longitude, latitude] = feature.center;

    return {
      longitude,
      latitude,
      formattedAddress: feature.place_name,
    };
  } catch (error) {
    console.error("Geocoding error:", error.message);
    throw new Error(`Failed to geocode address: ${error.message}`);
  }
};

/**
 * Calculate distance between two coordinates using Mapbox Directions API
 * @param {Object} from - { longitude, latitude }
 * @param {Object} to - { longitude, latitude }
 * @returns {Promise<Object>} - { distanceKm, durationMinutes }
 */
exports.calculateDistance = async (from, to) => {
  try {
    if (!MAPBOX_API_KEY) {
      throw new Error("Mapbox API key not configured");
    }

    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;

    const response = await axios.get(
      `${MAPBOX_BASE_URL}/directions/v5/mapbox/driving/${coordinates}`,
      {
        params: {
          access_token: MAPBOX_API_KEY,
          geometries: "geojson",
        },
      }
    );

    if (!response.data.routes || response.data.routes.length === 0) {
      throw new Error("No route found");
    }

    const route = response.data.routes[0];
    const distanceMeters = route.distance;
    const durationSeconds = route.duration;

    return {
      distanceKm: (distanceMeters / 1000).toFixed(2),
      durationMinutes: Math.ceil(durationSeconds / 60),
      geometry: route.geometry, // GeoJSON for displaying route on map
    };
  } catch (error) {
    console.error("Distance calculation error:", error.message);

    // Fallback to Haversine formula if API fails
    const distance = calculateHaversineDistance(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude
    );

    return {
      distanceKm: distance.toFixed(2),
      durationMinutes: Math.ceil(distance * 2), // Rough estimate: 2 min per km
      geometry: null,
    };
  }
};

/**
 * Haversine formula for calculating distance between two coordinates
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} - Distance in kilometers
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Find care givers within a certain radius
 * @param {Object} centerPoint - { longitude, latitude }
 * @param {number} radiusKm - Radius in kilometers
 * @returns {Promise<Array>} - Array of care giver IDs within radius
 */
exports.findCareGiversWithinRadius = async (centerPoint, radiusKm) => {
  const CareGiver = require("../models/CareGiver");

  try {
    // MongoDB geospatial query
    const careGivers = await CareGiver.find({
      coordinates: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [centerPoint.longitude, centerPoint.latitude],
          },
          $maxDistance: radiusKm * 1000, // Convert to meters
        },
      },
      isActive: true,
    }).select("_id name coordinates");

    return careGivers;
  } catch (error) {
    console.error("Find care givers within radius error:", error.message);
    throw error;
  }
};

/**
 * Get route geometry for displaying on map
 * @param {Array} coordinates - Array of [longitude, latitude] pairs
 * @returns {Promise<Object>} - Route geometry and details
 */
exports.getRouteGeometry = async (coordinates) => {
  try {
    if (!MAPBOX_API_KEY) {
      throw new Error("Mapbox API key not configured");
    }

    const coordinatesString = coordinates
      .map((coord) => `${coord[0]},${coord[1]}`)
      .join(";");

    const response = await axios.get(
      `${MAPBOX_BASE_URL}/directions/v5/mapbox/driving/${coordinatesString}`,
      {
        params: {
          access_token: MAPBOX_API_KEY,
          geometries: "geojson",
          overview: "full",
        },
      }
    );

    if (!response.data.routes || response.data.routes.length === 0) {
      throw new Error("No route found");
    }

    const route = response.data.routes[0];

    return {
      geometry: route.geometry,
      distance: (route.distance / 1000).toFixed(2), // km
      duration: Math.ceil(route.duration / 60), // minutes
    };
  } catch (error) {
    console.error("Route geometry error:", error.message);
    throw error;
  }
};
