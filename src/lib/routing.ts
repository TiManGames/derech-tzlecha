import { RoutePoint, Route, RouteMetrics, Shelter } from '@/types';
import * as turf from '@turf/turf';
import { ShelterSpatialIndex } from './spatial';

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjBkM2Q2YThjODYxZDQ4YTg4ZDM0ZGIyMDUzZDA1YzNlIiwiaCI6Im11cm11cjY0In0=';
const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';

interface ORSRoute {
  geometry: {
    coordinates: [number, number][];
    type: 'LineString';
  };
  properties: {
    summary: {
      distance: number; // meters
      duration: number; // seconds
    };
    segments: unknown[];
  };
  summary: {
    distance: number;
    duration: number;
  };
}

interface ORSGeoJSONResponse {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      coordinates: [number, number][];
      type: 'LineString';
    };
    properties: {
      summary: {
        distance: number;
        duration: number;
      };
    };
  }>;
}

/**
 * Get walking routes from OpenRouteService
 * Requests alternative routes when possible
 */
export async function getWalkingRoutes(
  origin: RoutePoint,
  destination: RoutePoint
): Promise<ORSRoute[]> {
  const body = {
    coordinates: [
      [origin.lon, origin.lat],
      [destination.lon, destination.lat]
    ],
    alternative_routes: {
      target_count: 3,
      weight_factor: 1.6,
      share_factor: 0.6
    }
  };

  try {
    const response = await fetch(ORS_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ORS_API_KEY
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ORS API error response:', errorText);
      throw new Error(`ORS API error: ${response.status} - ${errorText}`);
    }

    const data: ORSGeoJSONResponse = await response.json();
    
    // Convert GeoJSON features to our route format
    return data.features.map(feature => ({
      geometry: feature.geometry,
      properties: feature.properties,
      summary: feature.properties.summary
    })) as unknown as ORSRoute[];
  } catch (error) {
    console.error('Error fetching routes:', error);
    throw error;
  }
}

/**
 * Score and rank routes based on safety (shelter proximity)
 */
export function scoreAndRankRoutes(
  orsRoutes: ORSRoute[],
  spatialIndex: ShelterSpatialIndex,
  safetyWeight: number // 0-1
): Route[] {
  const scoredRoutes = orsRoutes.map(orsRoute => {
    const geometry: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: orsRoute.geometry.coordinates
    };

    const metrics = calculateRouteMetrics(
      geometry,
      orsRoute.summary.distance,
      orsRoute.summary.duration,
      spatialIndex
    );

    const nearbyShelters = spatialIndex.getSheltersNearRoute(geometry, 200);

    return {
      geometry,
      metrics,
      nearbyShelters
    };
  });

  // Sort by combined score (lower is better)
  return scoredRoutes.sort((a, b) => {
    const scoreA = calculateCombinedScore(a.metrics, safetyWeight);
    const scoreB = calculateCombinedScore(b.metrics, safetyWeight);
    return scoreA - scoreB;
  });
}

/**
 * Calculate route metrics including safety scores
 */
function calculateRouteMetrics(
  geometry: GeoJSON.LineString,
  distanceMeters: number,
  durationSeconds: number,
  spatialIndex: ShelterSpatialIndex
): RouteMetrics {
  // Sample points along the route every 25 meters
  const line = turf.lineString(geometry.coordinates);
  const lengthKm = turf.length(line, { units: 'kilometers' });
  const sampleCount = Math.max(10, Math.ceil(lengthKm * 1000 / 25));
  
  const samplePoints: [number, number][] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const fraction = i / sampleCount;
    const point = turf.along(line, lengthKm * fraction, { units: 'kilometers' });
    samplePoints.push(point.geometry.coordinates as [number, number]);
  }

  // Calculate distances to nearest shelter for each sample point
  const distances = samplePoints.map(([lon, lat]) => 
    spatialIndex.getNearestShelterDistance(lat, lon)
  );

  const maxGapToShelter = Math.max(...distances);
  const avgDistanceToShelter = distances.reduce((a, b) => a + b, 0) / distances.length;
  const sheltersNearRoute = spatialIndex.getSheltersNearRoute(geometry, 150).length;

  // Calculate safety score (0-100, higher is safer)
  // Penalize large gaps heavily
  const gapPenalty = Math.min(100, maxGapToShelter / 5); // 500m gap = 100 penalty
  const avgPenalty = Math.min(50, avgDistanceToShelter / 4); // 200m avg = 50 penalty
  const shelterBonus = Math.min(30, sheltersNearRoute * 3); // Up to 30 bonus for nearby shelters
  
  const safetyScore = Math.max(0, Math.min(100, 100 - gapPenalty - avgPenalty + shelterBonus));

  return {
    distanceKm: distanceMeters / 1000,
    durationMinutes: durationSeconds / 60,
    maxGapToShelter,
    avgDistanceToShelter,
    sheltersNearRoute,
    safetyScore
  };
}

/**
 * Calculate combined score for ranking (lower is better)
 */
function calculateCombinedScore(metrics: RouteMetrics, safetyWeight: number): number {
  // Normalize distance (assume max reasonable walk is 10km)
  const normalizedDistance = metrics.distanceKm / 10;
  
  // Normalize safety (invert so lower is better)
  const normalizedRisk = 1 - (metrics.safetyScore / 100);
  
  // Combine with weight
  return (1 - safetyWeight) * normalizedDistance + safetyWeight * normalizedRisk;
}

/**
 * Geocode an address using Nominatim
 */
export async function geocodeAddress(address: string): Promise<RoutePoint | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${address}, תל אביב, ישראל`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'DerechTzlecha/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const results = await response.json();
    
    if (results.length === 0) {
      return null;
    }

    const result = results[0];
    return {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      address: result.display_name
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    throw error;
  }
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', lat.toString());
  url.searchParams.set('lon', lon.toString());
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'DerechTzlecha/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const result = await response.json();
    return result.display_name || 'מיקום לא ידוע';
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return 'מיקום לא ידוע';
  }
}