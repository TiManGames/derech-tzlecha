import { Shelter, ShelterFeature, ShelterGeoJSON, ShelterType } from '@/types';

// Tel Aviv ArcGIS API configuration
const TEL_AVIV_ARCGIS_URL = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query';
const TEL_AVIV_PAGE_SIZE = 2000;

// Jerusalem CKAN API configuration
const JERUSALEM_CKAN_URL = 'https://jerusalem.datacity.org.il/api/3/action/datastore_search';
const JERUSALEM_RESOURCE_ID = 'f487babc-5bec-45da-93bd-37aab76f8df8';
const JERUSALEM_PAGE_SIZE = 5000;

// Jerusalem shelter record interface (from CKAN API)
interface JerusalemShelterRecord {
  _id: number;
  neighborhood?: string;
  'Shleter Number'?: string;
  shelterNumber?: string;
  address?: string;
  area?: string;
  type?: string;
  capacity?: number | string;
  operator?: string;
  'X-axis coordinates'?: string | number;
  'Y axis coordinates'?: string | number;
  xAxisCoordinates?: string | number;
  yAxisCoordinates?: string | number;
  'Address for the map'?: string;
  addressForMap?: string;
  administration?: string;
  category?: string;
  [key: string]: unknown;
}

interface JerusalemCKANResponse {
  success: boolean;
  result: {
    records: JerusalemShelterRecord[];
    total: number;
    _links?: {
      next?: string;
    };
  };
}

/**
 * Fetch all shelters from Tel Aviv ArcGIS layer 592
 * Uses pagination to get all records
 */
async function fetchTelAvivShelters(): Promise<Shelter[]> {
  const allFeatures: ShelterFeature[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(TEL_AVIV_ARCGIS_URL);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('resultRecordCount', TEL_AVIV_PAGE_SIZE.toString());
    url.searchParams.set('resultOffset', offset.toString());

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: ShelterGeoJSON = await response.json();
      
      if (data.features && data.features.length > 0) {
        allFeatures.push(...data.features);
        offset += TEL_AVIV_PAGE_SIZE;
        
        // If we got fewer than PAGE_SIZE, we've reached the end
        if (data.features.length < TEL_AVIV_PAGE_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching Tel Aviv shelters:', error);
      throw error;
    }
  }

  return allFeatures.map(telAvivFeatureToShelter);
}

/**
 * Fetch all shelters from Jerusalem CKAN DataStore API
 * Uses pagination to get all records
 */
async function fetchJerusalemShelters(): Promise<Shelter[]> {
  const allRecords: JerusalemShelterRecord[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(JERUSALEM_CKAN_URL);
    url.searchParams.set('resource_id', JERUSALEM_RESOURCE_ID);
    url.searchParams.set('limit', JERUSALEM_PAGE_SIZE.toString());
    url.searchParams.set('offset', offset.toString());

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: JerusalemCKANResponse = await response.json();
      
      if (!data.success) {
        throw new Error('CKAN API returned unsuccessful response');
      }
      
      if (data.result.records && data.result.records.length > 0) {
        allRecords.push(...data.result.records);
        offset += JERUSALEM_PAGE_SIZE;
        
        // If we got fewer than PAGE_SIZE, we've reached the end
        if (data.result.records.length < JERUSALEM_PAGE_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching Jerusalem shelters:', error);
      throw error;
    }
  }

  // Filter out records with invalid coordinates and convert to Shelter type
  return allRecords
    .map(jerusalemRecordToShelter)
    .filter((shelter): shelter is Shelter => shelter !== null);
}

/**
 * Convert Tel Aviv ArcGIS feature to our Shelter type
 */
function telAvivFeatureToShelter(feature: ShelterFeature): Shelter {
  const props = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;

  return {
    id: `ta-${props.oid_mitkan || props.OBJECTID || feature.id || Math.random()}`,
    lat: props.lat || lat,
    lon: props.lon || lon,
    address: props.Full_Address || props.shem_recho || 'כתובת לא ידועה',
    type: parseShelterType(props.t_sug),
    isAccessible: parseAccessibility(props.h_sug) || props.miklat_mungash !== null,
    isOpen: props.is_open === 'כן' || props.is_open === 'yes',
    openingTimes: props.opening_times,
    capacity: props.shetach_mr,
    city: 'tel-aviv',
  };
}

/**
 * Convert Jerusalem CKAN record to our Shelter type
 * Returns null if coordinates are invalid
 * 
 * Note: Jerusalem data has coordinates already in WGS84, but mislabeled:
 * - "X-axis coordinates" = latitude
 * - "Y axis coordinates" = longitude
 */
function jerusalemRecordToShelter(record: JerusalemShelterRecord): Shelter | null {
  // Get X and Y coordinates (handle different field name formats)
  // Note: X-axis is actually latitude, Y-axis is actually longitude in this dataset
  const xCoord = record['X-axis coordinates'] ?? record.xAxisCoordinates;
  const yCoord = record['Y axis coordinates'] ?? record.yAxisCoordinates;
  
  // Parse coordinates - X is latitude, Y is longitude (mislabeled in source data)
  const lat = typeof xCoord === 'string' ? parseFloat(xCoord) : xCoord;
  const lon = typeof yCoord === 'string' ? parseFloat(yCoord) : yCoord;
  
  // Validate coordinates
  if (!lat || !lon || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
    return null;
  }
  
  // Validate coordinates are within Israel bounds (already WGS84)
  if (lat < 29 || lat > 34 || lon < 34 || lon > 36) {
    console.warn(`Invalid coordinates for Jerusalem shelter ${record._id}: lat=${lat}, lon=${lon}`);
    return null;
  }
  
  // Get address (handle different field name formats)
  const address = record['Address for the map'] || record.addressForMap || record.address || 'כתובת לא ידועה';
  
  // Get shelter number (handle different field name formats)
  const shelterNumber = record['Shleter Number'] || record.shelterNumber || '';
  
  // Parse capacity
  const capacity = typeof record.capacity === 'string' 
    ? parseInt(record.capacity, 10) 
    : record.capacity;
  
  return {
    id: `jlm-${record._id}`,
    lat,
    lon,
    address: typeof address === 'string' ? address : 'כתובת לא ידועה',
    type: parseJerusalemShelterType(record.type, record.category),
    isAccessible: false, // Jerusalem data doesn't have accessibility info
    capacity: isNaN(capacity as number) ? undefined : capacity as number,
    city: 'jerusalem',
  };
}

/**
 * Parse shelter type from Tel Aviv Hebrew string
 */
function parseShelterType(typeStr?: string): ShelterType {
  if (!typeStr) return 'other';
  
  const normalized = typeStr.trim();
  
  if (normalized.includes('נגיש')) {
    return 'accessible_shelter';
  }
  if (normalized.includes('חניון') || normalized.includes('מחסה')) {
    return 'parking_shelter';
  }
  if (normalized.includes('מדרגות')) {
    return 'stairwell';
  }
  if (normalized.includes('מקלט') && normalized.includes('ציבורי')) {
    return 'public_shelter';
  }
  
  return 'other';
}

/**
 * Parse shelter type from Jerusalem data
 */
function parseJerusalemShelterType(type?: string, category?: string): ShelterType {
  const typeStr = (type || '').trim().toLowerCase();
  const categoryStr = (category || '').trim().toLowerCase();
  
  // Check for parking/underground shelters
  if (typeStr.includes('חניון') || categoryStr.includes('חניון')) {
    return 'parking_shelter';
  }
  
  // Check for stairwell
  if (typeStr.includes('מדרגות') || categoryStr.includes('מדרגות')) {
    return 'stairwell';
  }
  
  // Check for accessible
  if (typeStr.includes('נגיש') || categoryStr.includes('נגיש')) {
    return 'accessible_shelter';
  }
  
  // Default to public shelter for Jerusalem data
  return 'public_shelter';
}

/**
 * Parse accessibility from Hebrew string
 */
function parseAccessibility(accessStr?: string): boolean {
  if (!accessStr) return false;
  const normalized = accessStr.trim().toLowerCase();
  return normalized === 'כן' || normalized === 'yes' || normalized === 'נגיש';
}

/**
 * Fetch all shelters from all supported cities
 * Fetches from Tel Aviv and Jerusalem in parallel
 */
export async function fetchAllShelters(): Promise<Shelter[]> {
  try {
    // Fetch from both cities in parallel
    const [telAvivShelters, jerusalemShelters] = await Promise.all([
      fetchTelAvivShelters().catch(error => {
        console.error('Failed to fetch Tel Aviv shelters:', error);
        return [] as Shelter[];
      }),
      fetchJerusalemShelters().catch(error => {
        console.error('Failed to fetch Jerusalem shelters:', error);
        return [] as Shelter[];
      }),
    ]);
    
    console.log(`Loaded ${telAvivShelters.length} Tel Aviv shelters and ${jerusalemShelters.length} Jerusalem shelters`);
    
    // Merge all shelters
    return [...telAvivShelters, ...jerusalemShelters];
  } catch (error) {
    console.error('Error fetching shelters:', error);
    throw error;
  }
}

/**
 * Get Hebrew label for shelter type
 */
export function getShelterTypeLabel(type: ShelterType): string {
  const labels: Record<ShelterType, string> = {
    public_shelter: 'מקלט ציבורי',
    accessible_shelter: 'מקלט ציבורי נגיש',
    parking_shelter: 'חניון מחסה',
    stairwell: 'חדר מדרגות מוגן',
    other: 'מרחב מוגן',
  };
  return labels[type];
}

/**
 * Get marker color for shelter type
 * Blue for regular shelters, purple for parking shelters
 */
export function getShelterColor(type: ShelterType): string {
  if (type === 'parking_shelter') {
    return '#9333ea'; // purple for parking shelters
  }
  return '#2563eb'; // blue for all other shelters
}

/**
 * Filter shelters based on user preferences
 */
export function filterShelters(
  shelters: Shelter[],
  filters: {
    showPublicShelters: boolean;
    showAccessibleOnly: boolean;
    showParkingShelters: boolean;
  }
): Shelter[] {
  return shelters.filter(shelter => {
    // If accessible only, filter out non-accessible
    if (filters.showAccessibleOnly && !shelter.isAccessible) {
      return false;
    }

    // Filter by type
    if (shelter.type === 'public_shelter' || shelter.type === 'accessible_shelter') {
      return filters.showPublicShelters;
    }
    if (shelter.type === 'parking_shelter') {
      return filters.showParkingShelters;
    }

    // Show other types if public shelters are enabled
    return filters.showPublicShelters;
  });
}