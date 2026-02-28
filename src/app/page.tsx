'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Shelter, Route, RoutePoint } from '@/types';
import { fetchAllShelters, filterShelters, getShelterColor, getShelterTypeLabel } from '@/lib/shelters';
import { getWalkingRoutes, scoreAndRankRoutes, geocodeAddress, reverseGeocode } from '@/lib/routing';
import { ShelterSpatialIndex } from '@/lib/spatial';

// Tel Aviv center coordinates
const TEL_AVIV_CENTER: [number, number] = [34.7818, 32.0853];
const DEFAULT_ZOOM = 13;

export default function Home() {
  // Map state
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);

  // App state
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [spatialIndex, setSpatialIndex] = useState<ShelterSpatialIndex | null>(null);
  const [sheltersLoading, setSheltersLoading] = useState(true);
  const [sheltersError, setSheltersError] = useState<string | null>(null);

  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const [destination, setDestination] = useState<RoutePoint | null>(null);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [safetyWeight, setSafetyWeight] = useState(0.5);

  const [filters, setFilters] = useState({
    showPublicShelters: true,
    showAccessibleOnly: false,
    showParkingShelters: true,
  });

  const [mapReady, setMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: TEL_AVIV_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.current.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-left'
    );

    map.current.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-left'
    );

    map.current.on('load', () => {
      setMapReady(true);
    });

    // Handle map clicks for setting origin/destination
    map.current.on('click', async (e) => {
      const { lng, lat } = e.lngLat;
      handleMapClick(lat, lng);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Handle map click
  const handleMapClick = async (lat: number, lng: number) => {
    if (!origin) {
      const address = await reverseGeocode(lat, lng);
      const shortAddress = address.split(',')[0];
      setOrigin({ lat, lon: lng, address });
      setOriginInput(shortAddress);
    } else if (!destination) {
      const address = await reverseGeocode(lat, lng);
      const shortAddress = address.split(',')[0];
      setDestination({ lat, lon: lng, address });
      setDestinationInput(shortAddress);
    }
  };

  // Fetch shelters on mount
  useEffect(() => {
    async function loadShelters() {
      try {
        setSheltersLoading(true);
        setSheltersError(null);
        const data = await fetchAllShelters();
        setShelters(data);
        setSpatialIndex(new ShelterSpatialIndex(data));
      } catch (error) {
        console.error('Failed to load shelters:', error);
        setSheltersError('שגיאה בטעינת המקלטים. נסה לרענן את הדף.');
      } finally {
        setSheltersLoading(false);
      }
    }
    loadShelters();
  }, []);

  // Update shelter markers when shelters or filters change
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Filter shelters
    const filteredShelters = filterShelters(shelters, filters);

    // Add markers for filtered shelters
    filteredShelters.forEach(shelter => {
      const el = document.createElement('div');
      el.className = 'shelter-marker';
      el.style.backgroundColor = getShelterColor(shelter.type);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([shelter.lon, shelter.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(`
            <div class="popup-title">${getShelterTypeLabel(shelter.type)}</div>
            <div class="popup-address">${shelter.address}</div>
            ${shelter.isAccessible ? '<span class="popup-type">♿ נגיש</span>' : ''}
          `)
        )
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [shelters, filters, mapReady]);

  // Update origin marker
  useEffect(() => {
    if (!map.current || !mapReady) return;

    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }

    if (origin) {
      const el = document.createElement('div');
      el.className = 'point-marker origin';
      el.innerHTML = 'א';

      originMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([origin.lon, origin.lat])
        .addTo(map.current);
    }
  }, [origin, mapReady]);

  // Update destination marker
  useEffect(() => {
    if (!map.current || !mapReady) return;

    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }

    if (destination) {
      const el = document.createElement('div');
      el.className = 'point-marker destination';
      el.innerHTML = 'ב';

      destMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([destination.lon, destination.lat])
        .addTo(map.current);
    }
  }, [destination, mapReady]);

  // Draw route on map
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Remove existing route layer
    if (map.current.getLayer('route')) {
      map.current.removeLayer('route');
    }
    if (map.current.getLayer('route-outline')) {
      map.current.removeLayer('route-outline');
    }
    if (map.current.getSource('route')) {
      map.current.removeSource('route');
    }

    if (routes.length > 0 && routes[selectedRouteIndex]) {
      const route = routes[selectedRouteIndex];

      map.current.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: route.geometry,
        },
      });

      map.current.addLayer({
        id: 'route-outline',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#1d4ed8',
          'line-width': 8,
          'line-opacity': 0.3,
        },
      });

      map.current.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#2563eb',
          'line-width': 4,
        },
      });

      // Fit map to route bounds
      const coordinates = route.geometry.coordinates as [number, number][];
      const bounds = coordinates.reduce(
        (bounds, coord) => bounds.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
      );

      map.current.fitBounds(bounds, { padding: 100 });
    }
  }, [routes, selectedRouteIndex, mapReady]);

  // Search for route
  const handleSearch = async () => {
    if (!origin || !destination || !spatialIndex) return;

    setRouteLoading(true);
    setRouteError(null);
    setRoutes([]);

    try {
      const orsRoutes = await getWalkingRoutes(origin, destination);
      
      if (orsRoutes.length === 0) {
        setRouteError('לא נמצא מסלול. נסה כתובות אחרות.');
        return;
      }

      const scoredRoutes = scoreAndRankRoutes(orsRoutes, spatialIndex, safetyWeight);
      setRoutes(scoredRoutes);
      setSelectedRouteIndex(0);
    } catch (error) {
      console.error('Route search failed:', error);
      setRouteError('שגיאה בחיפוש מסלול. נסה שוב.');
    } finally {
      setRouteLoading(false);
    }
  };

  // Geocode origin address
  const handleOriginSearch = async () => {
    if (!originInput.trim()) return;

    try {
      const result = await geocodeAddress(originInput);
      if (result) {
        setOrigin(result);
        if (map.current) {
          map.current.flyTo({ center: [result.lon, result.lat], zoom: 15 });
        }
      }
    } catch (error) {
      console.error('Geocoding failed:', error);
    }
  };

  // Geocode destination address
  const handleDestinationSearch = async () => {
    if (!destinationInput.trim()) return;

    try {
      const result = await geocodeAddress(destinationInput);
      if (result) {
        setDestination(result);
        if (map.current) {
          map.current.flyTo({ center: [result.lon, result.lat], zoom: 15 });
        }
      }
    } catch (error) {
      console.error('Geocoding failed:', error);
    }
  };

  // Clear route
  const handleClear = () => {
    setOrigin(null);
    setDestination(null);
    setOriginInput('');
    setDestinationInput('');
    setRoutes([]);
    setRouteError(null);
  };

  // Get user location
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      alert('הדפדפן שלך לא תומך במיקום');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const address = await reverseGeocode(latitude, longitude);
        setOrigin({ lat: latitude, lon: longitude, address });
        setOriginInput(address.split(',')[0]);
        
        if (map.current) {
          map.current.flyTo({ center: [longitude, latitude], zoom: 15 });
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('לא הצלחנו לקבל את המיקום שלך');
      }
    );
  };

  // Get safety badge class
  const getSafetyBadgeClass = (score: number): string => {
    if (score >= 70) return 'safe';
    if (score >= 40) return 'moderate';
    return 'risky';
  };

  // Get safety badge text
  const getSafetyBadgeText = (score: number): string => {
    if (score >= 70) return 'בטוח';
    if (score >= 40) return 'בינוני';
    return 'פחות בטוח';
  };

  return (
    <main style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {/* Map */}
      <div ref={mapContainer} className="map-container" />

      {/* Location button */}
      <button className="location-btn" onClick={handleGetLocation} title="המיקום שלי">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
        </svg>
      </button>

      {/* Control Panel */}
      <div className="control-panel">
        <div className="panel-header">
          <h1>🛡️ דרך צלחה</h1>
          <p>מצא מסלול הליכה בטוח עם מקלטים</p>
        </div>

        <div className="panel-content">
          {/* Loading state */}
          {sheltersLoading && (
            <div className="loading">
              <div className="spinner"></div>
              <span>טוען מקלטים...</span>
            </div>
          )}

          {/* Error state */}
          {sheltersError && <div className="error">{sheltersError}</div>}
          {routeError && <div className="error">{routeError}</div>}

          {/* Route inputs */}
          {!sheltersLoading && (
            <>
              <div className="form-group">
                <label className="form-label">נקודת התחלה</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="הקלד כתובת או לחץ על המפה"
                  value={originInput}
                  onChange={(e) => setOriginInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleOriginSearch()}
                />
              </div>

              <div className="form-group">
                <label className="form-label">יעד</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="הקלד כתובת או לחץ על המפה"
                  value={destinationInput}
                  onChange={(e) => setDestinationInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDestinationSearch()}
                />
              </div>

              {/* Safety slider */}
              <div className="slider-container">
                <div className="slider-header">
                  <span className="slider-label">איזון בטיחות/מהירות</span>
                  <span className="slider-value">
                    {safetyWeight < 0.3 ? 'מהיר' : safetyWeight > 0.7 ? 'בטוח' : 'מאוזן'}
                  </span>
                </div>
                <input
                  type="range"
                  className="slider"
                  min="0"
                  max="1"
                  step="0.1"
                  value={safetyWeight}
                  onChange={(e) => setSafetyWeight(parseFloat(e.target.value))}
                />
                <div className="slider-labels">
                  <span>מהיר יותר</span>
                  <span>בטוח יותר</span>
                </div>
              </div>

              {/* Filters */}
              <div className="form-group">
                <label className="form-label">סינון מקלטים</label>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={filters.showPublicShelters}
                      onChange={(e) =>
                        setFilters({ ...filters, showPublicShelters: e.target.checked })
                      }
                    />
                    מקלטים ציבוריים
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={filters.showParkingShelters}
                      onChange={(e) =>
                        setFilters({ ...filters, showParkingShelters: e.target.checked })
                      }
                    />
                    חניונים מוגנים
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={filters.showAccessibleOnly}
                      onChange={(e) =>
                        setFilters({ ...filters, showAccessibleOnly: e.target.checked })
                      }
                    />
                    נגישים בלבד ♿
                  </label>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-primary btn-full"
                  onClick={handleSearch}
                  disabled={!origin || !destination || routeLoading}
                >
                  {routeLoading ? (
                    <>
                      <div className="spinner"></div>
                      מחפש...
                    </>
                  ) : (
                    '🔍 חפש מסלול'
                  )}
                </button>
                {(origin || destination) && (
                  <button className="btn btn-secondary" onClick={handleClear}>
                    נקה
                  </button>
                )}
              </div>

              {/* Route results */}
              {routes.length > 0 && (
                <div className="route-results">
                  <h3 style={{ fontSize: '0.875rem', marginBottom: '12px' }}>
                    נמצאו {routes.length} מסלולים
                  </h3>
                  {routes.map((route, index) => (
                    <div
                      key={index}
                      className={`route-card ${index === selectedRouteIndex ? 'selected' : ''}`}
                      onClick={() => setSelectedRouteIndex(index)}
                    >
                      <div className="route-header">
                        <span className="route-title">
                          מסלול {index + 1}
                          {index === 0 && ' (מומלץ)'}
                        </span>
                        <span className={`route-badge ${getSafetyBadgeClass(route.metrics.safetyScore)}`}>
                          {getSafetyBadgeText(route.metrics.safetyScore)}
                        </span>
                      </div>
                      <div className="route-metrics">
                        <div className="metric">
                          <span className="metric-label">מרחק</span>
                          <span className="metric-value">
                            {route.metrics.distanceKm.toFixed(1)} ק״מ
                          </span>
                        </div>
                        <div className="metric">
                          <span className="metric-label">זמן</span>
                          <span className="metric-value">
                            {Math.round(route.metrics.durationMinutes)} דק׳
                          </span>
                        </div>
                        <div className="metric">
                          <span className="metric-label">מקלטים בדרך</span>
                          <span className="metric-value">{route.metrics.sheltersNearRoute}</span>
                        </div>
                        <div className="metric">
                          <span className="metric-label">מרחק מקס׳ ממקלט</span>
                          <span className="metric-value">
                            {Math.round(route.metrics.maxGapToShelter)} מ׳
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Disclaimer */}
              <div className="disclaimer">
                <div className="disclaimer-title">⚠️ שימו לב</div>
                <div className="disclaimer-text">
                  המידע מוצג לצורכי תכנון בלבד. בעת אירוע חירום, יש לפעול לפי הנחיות פיקוד העורף.
                  <br />
                  <a
                    href="https://www.oref.org.il/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="disclaimer-link"
                  >
                    אתר פיקוד העורף →
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}