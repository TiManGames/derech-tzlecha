---
name: shelter-locations
description: Gives information on how to fetch shelter locations in Different Cities with live information, and some guidlines on what is the structure of the data. Use it when you want to know how to get shelter information and how to work with the data and how to poll the dataset. This is only here as a helpful guide.
---

# Shelter Locations Dataset

This skill provides information on how to fetch shelter/protected-space data from multiple cities in Israel.

## Supported Cities

1. **Tel Aviv** - ArcGIS REST API (GeoJSON)
2. **Jerusalem** - CKAN DataStore API (JSON)

---

# Tel Aviv Shelter Locations Dataset

## How to pull the dataset (GeoJSON)

ArcGIS REST "query" supports GeoJSON output and pagination (Result Offset / Result Record Count).
Example (client or backend):

### first page
curl 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=2000&resultOffset=0'

### next page
curl 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=2000&resultOffset=2000'

## TypeScript interface extracted from the response

```typescript
// GeoJSON Point Geometry
interface PointGeometry {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

// Shelter Properties (מקלט)
interface ShelterProperties {
  oid_mitkan: number;              // Object ID
  ms_miklat: number;               // Shelter number
  k_sug: number;                   // Type code
  t_sug: string;                   // Type description (e.g., "מקלט ציבורי")
  k_rechov: number;                // Street code
  shem_recho: string;              // Street name (Hebrew)
  ms_bait: number;                 // Building number
  knisa: string;                   // Entrance info
  Full_Address: string;            // Full address
  shem_rechov_eng: string;         // Street name (English)
  shetach_mr: number;              // Area in square meters
  k_sinon: number;                 // Filtration system code
  t_sinon: string;                 // Filtration system description
  hearot: string;                  // Notes/remarks
  h_sug: string;                   // Additional type indicator
  x_coord: number;                 // X coordinate (Israel TM Grid)
  y_coord: number;                 // Y coordinate (Israel TM Grid)
  lon: number;                     // Longitude (WGS84)
  lat: number;                     // Latitude (WGS84)
  shem_baalim: string | null;      // Owner name
  shem: string | null;             // Name
  pail: string;                    // Status (e.g., "כשיר לשימוש")
  from_time: string;               // Opening time
  to_time: string;                 // Closing time
  opening_times: string;           // Opening hours description
  url_tik: string | null;          // File URL
  telephone_henion: string | null; // Phone number
  maneger_name: string | null;     // Manager name
  email: string | null;            // Email
  celolar: string | null;          // Mobile phone
  is_open: string;                 // Is open ("כן"/"לא")
  UniqueId: string;                // Unique identifier
  date_import: string;             // Import date (DD/MM/YYYY HH:mm:ss)
  miklat_mungash: string | null;   // Accessible shelter info
}

// GeoJSON Feature for a single Shelter
interface ShelterFeature {
  type: "Feature";
  id: number;
  geometry: PointGeometry;
  properties: ShelterProperties;
}

// Root GeoJSON FeatureCollection
interface TelAvivSheltersResponse {
  type: "FeatureCollection";
  features: ShelterFeature[];
}
```

### Notes for Tel Aviv data:
- Nullable fields — contact details (email, celolar, maneger_name, etc.) and ownership info (shem_baalim, shem) can be null
- Dual coordinate systems — coordinates are available in both WGS84 (lon/lat) and the Israel Transverse Mercator grid (x_coord/y_coord)
- is_open is a string ("כן"/"לא") rather than a boolean

---

# Jerusalem Shelter Locations Dataset

## Data Source

Jerusalem's open-data portal (DataCity) publishes a "Public Shelters / Protected Spaces" dataset via CKAN Data API (DataStore). The dataset is updated to June 2025.

**Licensing:** ODbL (Open Database License)

## API Endpoints

### Basic query (returns JSON)
```
https://jerusalem.datacity.org.il/api/3/action/datastore_search?resource_id=f487babc-5bec-45da-93bd-37aab76f8df8&limit=5000
```

### With pagination (offset parameter)
```
https://jerusalem.datacity.org.il/api/3/action/datastore_search?resource_id=f487babc-5bec-45da-93bd-37aab76f8df8&limit=5000&offset=5000
```

### SQL query (server-side filtering)
```
https://jerusalem.datacity.org.il/api/3/action/datastore_search_sql?sql=SELECT%20*%20from%20%22f487babc-5bec-45da-93bd-37aab76f8df8%22%20LIMIT%205
```

### Alternative resource (CSV-backed)
```
https://jerusalem.datacity.org.il/api/3/action/datastore_search?resource_id=db096951-dd8b-4e76-876a-07c34a00cec5&limit=5000
```

## TypeScript Interface

```typescript
interface JerusalemShelterRecord {
  _id: number;                      // Unique record ID
  neighborhood?: string;            // Neighborhood name (Hebrew)
  'Shleter Number'?: string;        // Shelter number (note: typo in original data)
  shelterNumber?: string;           // Alternative field name
  address?: string;                 // Street address
  area?: string;                    // Area/region
  type?: string;                    // Shelter type
  capacity?: number | string;       // Capacity (may be string or number)
  operator?: string;                // Operating organization
  'X-axis coordinates'?: string | number;  // X coordinate (EPSG:2039)
  'Y axis coordinates'?: string | number;  // Y coordinate (EPSG:2039)
  xAxisCoordinates?: string | number;      // Alternative field name
  yAxisCoordinates?: string | number;      // Alternative field name
  'Address for the map'?: string;   // Display address for mapping
  addressForMap?: string;           // Alternative field name
  administration?: string;          // Administrative body
  category?: string;                // Category classification
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
```

## Important: Coordinate Handling

**Jerusalem coordinates are already in WGS84, but the field names are misleading!**

The API labels the fields as "X-axis coordinates" and "Y axis coordinates", but they actually contain:
- `"X-axis coordinates"` = **latitude** (e.g., 31.8103973)
- `"Y axis coordinates"` = **longitude** (e.g., 35.2213932)

**No coordinate transformation is needed** - just swap the field interpretation:

```typescript
// Jerusalem data has lat/lon already in WGS84, but mislabeled:
const lat = parseFloat(record['X-axis coordinates']); // X is actually latitude
const lon = parseFloat(record['Y axis coordinates']); // Y is actually longitude
```

### Validation
Validate that coordinates fall within Israel bounds:
- Latitude: 29° to 34° N
- Longitude: 34° to 36° E

---

# Unified Shelter Interface

The app uses a unified `Shelter` interface that works with both data sources:

```typescript
type City = 'tel-aviv' | 'jerusalem';

type ShelterType = 
  | 'public_shelter'      // מקלט ציבורי
  | 'accessible_shelter'  // מקלט ציבורי נגיש
  | 'parking_shelter'     // חניון מחסה לציבור
  | 'stairwell'          // חדר מדרגות מוגן
  | 'other';

interface Shelter {
  id: string;           // Prefixed with 'ta-' or 'jlm-' for source identification
  lat: number;          // WGS84 latitude
  lon: number;          // WGS84 longitude
  address: string;      // Display address
  type: ShelterType;    // Normalized shelter type
  isAccessible: boolean;// Accessibility flag
  isOpen?: boolean;     // Open status (Tel Aviv only)
  openingTimes?: string;// Opening hours (Tel Aviv only)
  capacity?: number;    // Capacity (both sources)
  city: City;           // Source city identifier
}
```

---

# Additional Jerusalem Datasets

The Jerusalem DataCity portal also has:
- **School shelters available to the public** - useful for broader "protected spaces" coverage
- Direct downloads available in CSV, JSON, XML, GeoJSON, and XLSX formats

Portal URL: https://jerusalem.datacity.org.il/