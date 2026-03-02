import RBush from 'rbush';
import * as turf from '@turf/turf';
import { Shelter, ShelterBBox } from '@/types';

/**
 * Spatial index for fast shelter proximity queries
 * Uses R-tree (rbush) for efficient spatial lookups
 */
export class ShelterSpatialIndex {
  private tree: RBush<ShelterBBox>;
  private shelters: Shelter[];

  constructor(shelters: Shelter[]) {
    this.shelters = shelters;
    this.tree = new RBush<ShelterBBox>();
    this.buildIndex();
  }

  /**
   * Build the R-tree index from shelters
   */
  private buildIndex(): void {
    const items: ShelterBBox[] = this.shelters.map(shelter => ({
      minX: shelter.lon,
      minY: shelter.lat,
      maxX: shelter.lon,
      maxY: shelter.lat,
      shelter
    }));
    
    this.tree.load(items);
  }

  /**
   * Get the nearest shelter to a point
   */
  getNearestShelter(lat: number, lon: number): Shelter | null {
    // Search in expanding radius until we find something
    const searchRadii = [0.001, 0.002, 0.003]; // degrees (~100m to ~300m walking distance)
    
    for (const radius of searchRadii) {
      const candidates = this.tree.search({
        minX: lon - radius,
        minY: lat - radius,
        maxX: lon + radius,
        maxY: lat + radius
      });

      if (candidates.length > 0) {
        // Find the actual nearest among candidates
        let nearest: Shelter | null = null;
        let minDist = Infinity;

        for (const candidate of candidates) {
          const dist = this.haversineDistance(lat, lon, candidate.shelter.lat, candidate.shelter.lon);
          if (dist < minDist) {
            minDist = dist;
            nearest = candidate.shelter;
          }
        }

        return nearest;
      }
    }

    return null;
  }

  /**
   * Get distance to nearest shelter in meters
   */
  getNearestShelterDistance(lat: number, lon: number): number {
    const nearest = this.getNearestShelter(lat, lon);
    if (!nearest) {
      return Infinity;
    }
    return this.haversineDistance(lat, lon, nearest.lat, nearest.lon);
  }

  /**
   * Get all shelters within a radius (meters) of a point
   */
  getSheltersWithinRadius(lat: number, lon: number, radiusMeters: number): Shelter[] {
    // Convert meters to approximate degrees (rough estimate)
    const radiusDegrees = radiusMeters / 111000;
    
    const candidates = this.tree.search({
      minX: lon - radiusDegrees,
      minY: lat - radiusDegrees,
      maxX: lon + radiusDegrees,
      maxY: lat + radiusDegrees
    });

    // Filter by actual distance
    return candidates
      .filter(c => this.haversineDistance(lat, lon, c.shelter.lat, c.shelter.lon) <= radiusMeters)
      .map(c => c.shelter);
  }

  /**
   * Get all shelters within a corridor around a route
   * @deprecated Use getSheltersNearRouteAdaptive for better coverage
   */
  getSheltersNearRoute(geometry: GeoJSON.LineString, corridorMeters: number): Shelter[] {
    // Get bounding box of the route with buffer
    const bbox = turf.bbox(turf.lineString(geometry.coordinates));
    const bufferDegrees = corridorMeters / 111000;
    
    const candidates = this.tree.search({
      minX: bbox[0] - bufferDegrees,
      minY: bbox[1] - bufferDegrees,
      maxX: bbox[2] + bufferDegrees,
      maxY: bbox[3] + bufferDegrees
    });

    // Filter by actual distance to route
    const line = turf.lineString(geometry.coordinates);
    
    return candidates
      .filter(c => {
        const point = turf.point([c.shelter.lon, c.shelter.lat]);
        const distance = turf.pointToLineDistance(point, line, { units: 'meters' });
        return distance <= corridorMeters;
      })
      .map(c => c.shelter);
  }

  /**
   * Get shelters near route with adaptive radius
   * 
   * Algorithm:
   * 1. Sample points along the route every 50m
   * 2. For each sample point:
   *    - If shelters exist within preferredRadius (150m), include them
   *    - If no shelters within preferredRadius, find and include the nearest shelter
   *      (up to maxFallbackRadius of 1km)
   * 3. Deduplicate the final list
   * 
   * This ensures every point along the route has at least one reachable shelter,
   * while not cluttering with distant shelters when closer ones exist.
   */
  getSheltersNearRouteAdaptive(
    geometry: GeoJSON.LineString,
    preferredRadiusMeters: number = 150,
    maxFallbackRadiusMeters: number = 1000,
    sampleIntervalMeters: number = 50
  ): Shelter[] {
    const line = turf.lineString(geometry.coordinates);
    const lengthKm = turf.length(line, { units: 'kilometers' });
    const lengthMeters = lengthKm * 1000;
    
    // Calculate number of sample points (at least 2: start and end)
    const sampleCount = Math.max(2, Math.ceil(lengthMeters / sampleIntervalMeters) + 1);
    
    // Use a Set to track unique shelter IDs
    const includedShelterIds = new Set<string>();
    const result: Shelter[] = [];
    
    // Sample points along the route
    for (let i = 0; i < sampleCount; i++) {
      const fraction = i / (sampleCount - 1);
      const distanceKm = lengthKm * fraction;
      const point = turf.along(line, distanceKm, { units: 'kilometers' });
      const [lon, lat] = point.geometry.coordinates;
      
      // First, try to find shelters within preferred radius
      const sheltersInPreferred = this.getSheltersWithinRadius(lat, lon, preferredRadiusMeters);
      
      if (sheltersInPreferred.length > 0) {
        // Found shelters within preferred radius - add them
        for (const shelter of sheltersInPreferred) {
          if (!includedShelterIds.has(shelter.id)) {
            includedShelterIds.add(shelter.id);
            result.push(shelter);
          }
        }
      } else {
        // No shelters within preferred radius - find the nearest one
        const nearest = this.getNearestShelterWithinRadius(lat, lon, maxFallbackRadiusMeters);
        if (nearest && !includedShelterIds.has(nearest.id)) {
          includedShelterIds.add(nearest.id);
          result.push(nearest);
        }
      }
    }
    
    return result;
  }

  /**
   * Get the nearest shelter within a maximum radius
   * Returns null if no shelter found within the radius
   */
  private getNearestShelterWithinRadius(lat: number, lon: number, maxRadiusMeters: number): Shelter | null {
    // Convert meters to approximate degrees
    const radiusDegrees = maxRadiusMeters / 111000;
    
    const candidates = this.tree.search({
      minX: lon - radiusDegrees,
      minY: lat - radiusDegrees,
      maxX: lon + radiusDegrees,
      maxY: lat + radiusDegrees
    });

    if (candidates.length === 0) {
      return null;
    }

    // Find the actual nearest among candidates
    let nearest: Shelter | null = null;
    let minDist = Infinity;

    for (const candidate of candidates) {
      const dist = this.haversineDistance(lat, lon, candidate.shelter.lat, candidate.shelter.lon);
      if (dist <= maxRadiusMeters && dist < minDist) {
        minDist = dist;
        nearest = candidate.shelter;
      }
    }

    return nearest;
  }

  /**
   * Calculate haversine distance between two points in meters
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Get all shelters (for map display)
   */
  getAllShelters(): Shelter[] {
    return this.shelters;
  }

  /**
   * Update the index with new shelters
   */
  updateShelters(shelters: Shelter[]): void {
    this.shelters = shelters;
    this.tree.clear();
    this.buildIndex();
  }
}