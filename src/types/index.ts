// City identifiers for multi-city support
export type City = 'tel-aviv' | 'jerusalem';

// Shelter types from multiple city data sources
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
  city: City;
}

export type ShelterType = 
  | 'public_shelter'      // מקלט ציבורי
  | 'accessible_shelter'  // מקלט ציבורי נגיש
  | 'parking_shelter'     // חניון מחסה לציבור
  | 'stairwell'          // חדר מדרגות מוגן
  | 'other';

export interface ShelterFeature {
  type: 'Feature';
  id?: number;
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    OBJECTID?: number;
    oid_mitkan?: number;
    ms_miklat?: number;
    k_sug?: number;
    t_sug?: string;
    k_rechov?: number;
    shem_recho?: string;
    ms_bait?: number;
    knisa?: string;
    Full_Address?: string;
    shem_rechov_eng?: string;
    shetach_mr?: number;
    k_sinon?: number;
    t_sinon?: string;
    hearot?: string;
    h_sug?: string;
    x_coord?: number;
    y_coord?: number;
    lon?: number;
    lat?: number;
    shem_baalim?: string;
    shem?: string;
    pail?: string;
    from_time?: string;
    to_time?: string;
    opening_times?: string;
    url_tik?: string;
    telephone_henion?: string;
    manager_name?: string;
    email?: string;
    celolar?: string;
    is_open?: string;
    UniqueId?: string;
    date_import?: string;
    miklat_mungash?: string;
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
  minDistanceToShelter: number; // meters - closest shelter along route
  maxGapToShelter: number;      // meters - farthest point from any shelter
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