---
name: shelter-locations
description: Gives information on how to fetch shelter locations in Tel Aviv with live information, and some guidlines on what is the structure of the data. Use it when you want to know how to get shelter information and how to work with the data and how to poll the dataset. This is only here as a helpful guide.
---

# How to pull the dataset (GeoJSON)

ArcGIS REST “query” supports GeoJSON output and pagination (Result Offset / Result Record Count).
Example (client or backend):

## first page
curl 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=2000&resultOffset=0'

## next page
curl 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=2000&resultOffset=2000'

# TypeScript interface extracted from the response

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

A few things worth noting:

Nullable fields — contact details (email, celolar, maneger_name, etc.) and ownership info (shem_baalim, shem) can be null
Dual coordinate systems — coordinates are available in both WGS84 (lon/lat) and the Israel Transverse Mercator grid (x_coord/y_coord)
is_open is a string ("כן"/"לא") rather than a boolean
