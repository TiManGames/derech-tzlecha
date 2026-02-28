import { Shelter, ShelterFeature, ShelterGeoJSON, ShelterType } from '@/types';

const ARCGIS_BASE_URL = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query';
const PAGE_SIZE = 2000;

/**
 * Fetch all shelters from Tel Aviv ArcGIS layer 592
 * Uses pagination to get all records
 */
export async function fetchAllShelters(): Promise<Shelter[]> {
  const allFeatures: ShelterFeature[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(ARCGIS_BASE_URL);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('resultRecordCount', PAGE_SIZE.toString());
    url.searchParams.set('resultOffset', offset.toString());

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: ShelterGeoJSON = await response.json();
      
      if (data.features && data.features.length > 0) {
        allFeatures.push(...data.features);
        offset += PAGE_SIZE;
        
        // If we got fewer than PAGE_SIZE, we've reached the end
        if (data.features.length < PAGE_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching shelters:', error);
      throw error;
    }
  }

  return allFeatures.map(featureToShelter);
}

/**
 * Convert ArcGIS feature to our Shelter type
 */
function featureToShelter(feature: ShelterFeature): Shelter {
  const props = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;

  // Field names from actual API response:
  // oid_mitkan, ms_miklat, k_sug, t_sug, k_rechov, shem_recho, ms_bait, knisa,
  // Full_Address, shem_rechov_eng, shetach_mr, k_sinon, t_sinon, hearot,
  // h_sug, x_coord, y_coord, lon, lat, shem_baalim, shem, pail,
  // from_time, to_time, opening_times, url_tik, telephone_henion,
  // manager_name, email, celolar, is_open, UniqueId, date_import, miklat_mungash

  return {
    id: (props.oid_mitkan || props.OBJECTID || feature.id || Math.random()).toString(),
    lat: props.lat || lat,
    lon: props.lon || lon,
    address: props.Full_Address || props.shem_recho || 'כתובת לא ידועה',
    type: parseShelterType(props.t_sug),
    isAccessible: parseAccessibility(props.h_sug) || props.miklat_mungash !== null,
    isOpen: props.is_open === 'כן' || props.is_open === 'yes',
    openingTimes: props.opening_times,
    capacity: props.shetach_mr,
  };
}

/**
 * Parse shelter type from Hebrew string
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
 * Parse accessibility from Hebrew string
 */
function parseAccessibility(accessStr?: string): boolean {
  if (!accessStr) return false;
  const normalized = accessStr.trim().toLowerCase();
  return normalized === 'כן' || normalized === 'yes' || normalized === 'נגיש';
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