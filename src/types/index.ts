// Shelter types from Tel Aviv ArcGIS layer 592
export interface Shelter {
  id: string;
  lat: number;
  lon: number;
  address: string;
  type: ShelterType;
  isAccessible: boolean;
  isOpen?: boolean;
  openingTimes?: string;
  capacity?: number;
}

export type ShelterType = 
  | 'public_shelter'      // מקלט ציבורי
  | 'accessible_shelter'  // מקלט ציבורי נגיש
  | 'parking_shelter'     // חניון מחסה לציבור
  | 'stairwell'          // חדר מדרגות מוגן
  | 'other';

export interface ShelterFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    OBJECTID: number;
    address?: string;
    sug_miklat?: string;
    nagish?: string;
    is_open?: string;
    opening_times?: string;
    capacity?: number;
    [key: string]: unknown;
  };
}

export interface ShelterGeoJSON {
  type: 'FeatureCollection';
  features: ShelterFeature[];
}

// Route types
export interface RoutePoint {
  lat: number;
  lon: number;
  address?: string;
}

export interface RouteMetrics {
  distanceKm: number;
  durationMinutes: number;
  maxGapToShelter: number;      // meters
  avgDistanceToShelter: number; // meters
  sheltersNearRoute: number;    // count within corridor
  safetyScore: number;          // 0-100
}

export interface Route {
  geometry: GeoJSON.LineString;
  metrics: RouteMetrics;
  nearbyShelters: Shelter[];
}

// App state
export interface AppState {
  shelters: Shelter[];
  sheltersLoading: boolean;
  sheltersError: string | null;
  
  origin: RoutePoint | null;
  destination: RoutePoint | null;
  
  routes: Route[];
  selectedRouteIndex: number;
  routeLoading: boolean;
  routeError: string | null;
  
  safetyWeight: number; // 0-1 (alpha)
  
  filters: {
    showPublicShelters: boolean;
    showAccessibleOnly: boolean;
    showParkingShelters: boolean;
  };
}

// Spatial index types for rbush
export interface ShelterBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  shelter: Shelter;
}