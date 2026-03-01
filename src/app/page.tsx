'use client';

import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Shelter, Route, RoutePoint } from '@/types';

// Set RTL text plugin for proper Hebrew rendering on the map
if (typeof window !== 'undefined') {
  maplibregl.setRTLTextPlugin(
    'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
    true
  );
}
import { fetchAllShelters, filterShelters, getShelterColor, getShelterTypeLabel } from '@/lib/shelters';
import { getWalkingRoutes, scoreAndRankRoutes, geocodeAddress, reverseGeocode, getAddressSuggestions, AddressSuggestion } from '@/lib/routing';
import { ShelterSpatialIndex } from '@/lib/spatial';

// Tel Aviv center coordinates
const TEL_AVIV_CENTER: [number, number] = [34.7818, 32.0853];
const DEFAULT_ZOOM = 13;

// Location accuracy thresholds
const MAX_ACCURACY_THRESHOLD = 100; // Only show location if accuracy is better than 100 meters
const MAX_ACCURACY_CIRCLE_RADIUS = 100; // Cap the accuracy circle at 100 meters

// Helper function to create a circle GeoJSON polygon from center point and radius in meters
function createCircleGeoJSON(
  centerLon: number,
  centerLat: number,
  radiusMeters: number,
  points: number = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const earthRadius = 6371000; // Earth's radius in meters

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const latOffset = (radiusMeters / earthRadius) * Math.cos(angle);
    const lonOffset = (radiusMeters / earthRadius) * Math.sin(angle) / Math.cos(centerLat * Math.PI / 180);
    
    coords.push([
      centerLon + lonOffset * (180 / Math.PI),
      centerLat + latOffset * (180 / Math.PI)
    ]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [coords]
    }
  };
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default function Home() {
  // Map state
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const routeResultsRef = useRef<HTMLDivElement>(null);

  // Live location tracking state
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [mapBearing, setMapBearing] = useState<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const hasInitialCenterRef = useRef(false);

  // App state
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [spatialIndex, setSpatialIndex] = useState<ShelterSpatialIndex | null>(null);
  const [sheltersLoading, setSheltersLoading] = useState(true);
  const [sheltersError, setSheltersError] = useState<string | null>(null);

  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const [destination, setDestination] = useState<RoutePoint | null>(null);

  // Autocomplete state
  const [originSuggestions, setOriginSuggestions] = useState<AddressSuggestion[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<AddressSuggestion[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const [originFocused, setOriginFocused] = useState(false);
  const [destFocused, setDestFocused] = useState(false);

  // Debounced inputs for autocomplete
  const debouncedOriginInput = useDebounce(originInput, 300);
  const debouncedDestInput = useDebounce(destinationInput, 300);

  // Route state - only store the safest route
  const [safestRoute, setSafestRoute] = useState<Route | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    showPublicShelters: true,
    showAccessibleOnly: false,
    showParkingShelters: true,
  });

  const [mapReady, setMapReady] = useState(false);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);

  // Use refs to track current state for map click handler
  const originRef = useRef<RoutePoint | null>(null);
  const destinationRef = useRef<RoutePoint | null>(null);
  
  // Ref to store routeToShelter function for popup click handlers
  const routeToShelterRef = useRef<((lat: number, lon: number, address: string) => Promise<void>) | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    originRef.current = origin;
  }, [origin]);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  // Keep routeToShelter ref updated for popup click handlers
  useEffect(() => {
    routeToShelterRef.current = routeToShelter;
  });

  // Fetch origin suggestions
  useEffect(() => {
    async function fetchSuggestions() {
      if (debouncedOriginInput && originFocused && !origin) {
        const suggestions = await getAddressSuggestions(debouncedOriginInput);
        setOriginSuggestions(suggestions);
        setShowOriginSuggestions(suggestions.length > 0);
      } else {
        setOriginSuggestions([]);
        setShowOriginSuggestions(false);
      }
    }
    fetchSuggestions();
  }, [debouncedOriginInput, originFocused, origin]);

  // Fetch destination suggestions
  useEffect(() => {
    async function fetchSuggestions() {
      if (debouncedDestInput && destFocused && !destination) {
        const suggestions = await getAddressSuggestions(debouncedDestInput);
        setDestSuggestions(suggestions);
        setShowDestSuggestions(suggestions.length > 0);
      } else {
        setDestSuggestions([]);
        setShowDestSuggestions(false);
      }
    }
    fetchSuggestions();
  }, [debouncedDestInput, destFocused, destination]);

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

    // Track map rotation for direction cone compensation
    map.current.on('rotate', () => {
      if (map.current) {
        setMapBearing(map.current.getBearing());
      }
    });

    // Handle map clicks for setting origin/destination
    map.current.on('click', async (e) => {
      const { lng, lat } = e.lngLat;
      
      // Use refs to get current state values
      if (!originRef.current) {
        const address = await reverseGeocode(lat, lng);
        setOrigin({ lat, lon: lng, address });
        setOriginInput(address);
        setShowOriginSuggestions(false);
      } else if (!destinationRef.current) {
        const address = await reverseGeocode(lat, lng);
        setDestination({ lat, lon: lng, address });
        setDestinationInput(address);
        setShowDestSuggestions(false);
      }
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

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

  // Update shelter markers when shelters, filters, or route changes
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Filter shelters
    const filteredShelters = filterShelters(shelters, filters);

    // Get IDs of shelters near the route (if route exists)
    const nearbyShelterIds = new Set<string>(
      safestRoute?.nearbyShelters?.map(s => s.id) || []
    );

    // Add markers for filtered shelters
    filteredShelters.forEach(shelter => {
      const el = document.createElement('div');
      el.className = 'shelter-marker';
      el.style.backgroundColor = getShelterColor(shelter.type);
      
      // Check if this shelter is near the route
      const isNearRoute = nearbyShelterIds.has(shelter.id);
      if (isNearRoute) {
        el.classList.add('near-route');
      } else if (safestRoute) {
        // If there's a route but this shelter is not near it, fade it
        el.classList.add('faded');
      }
      
      // Add wheelchair icon for accessible shelters
      if (shelter.isAccessible) {
        el.innerHTML = '♿';
        el.classList.add('accessible');
      }

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
        <div class="popup-title">${getShelterTypeLabel(shelter.type)}</div>
        <div class="popup-address">${shelter.address}</div>
        ${shelter.isAccessible ? '<span class="popup-type">♿ נגיש</span>' : ''}
        ${isNearRoute ? '<span class="popup-type near-route-badge">📍 על המסלול</span>' : ''}
        <button class="popup-navigate-btn" data-lat="${shelter.lat}" data-lon="${shelter.lon}" data-address="${shelter.address}">
          🧭 נווט למקלט
        </button>
      `);

      // Attach click handler when popup opens
      popup.on('open', () => {
        const btn = document.querySelector('.popup-navigate-btn');
        if (btn) {
          btn.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const lat = parseFloat(target.getAttribute('data-lat') || '0');
            const lon = parseFloat(target.getAttribute('data-lon') || '0');
            const address = target.getAttribute('data-address') || '';
            
            // Close the popup
            popup.remove();
            
            // Route to the shelter
            if (routeToShelterRef.current) {
              routeToShelterRef.current(lat, lon, address);
            }
          });
        }
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([shelter.lon, shelter.lat])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [shelters, filters, mapReady, safestRoute]);

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
      // Location pin SVG icon
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>`;

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
      // Flag SVG icon
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/>
      </svg>`;

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

    if (safestRoute) {
      map.current.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: safestRoute.geometry,
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
      const coordinates = safestRoute.geometry.coordinates as [number, number][];
      const bounds = coordinates.reduce(
        (bounds, coord) => bounds.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
      );

      map.current.fitBounds(bounds, { padding: 100 });
    }
  }, [safestRoute, mapReady]);

  // Auto-scroll to results when route is found (mobile UX)
  useEffect(() => {
    if (safestRoute && routeResultsRef.current) {
      // Small delay to ensure the DOM has updated
      setTimeout(() => {
        routeResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [safestRoute]);

  // Start live location tracking when map is ready
  useEffect(() => {
    if (!mapReady || !map.current) return;
    if (!navigator.geolocation) return;

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading } = position.coords;
        
        // Only update location if accuracy is good enough
        if (accuracy <= MAX_ACCURACY_THRESHOLD) {
          setUserLocation({ lat: latitude, lon: longitude, accuracy });
          
          // Update heading if available (typically only on mobile when moving)
          if (heading !== null && !isNaN(heading)) {
            setUserHeading(heading);
          }
        } else {
          // If accuracy is poor, clear the location marker
          console.log(`Location accuracy too low: ${accuracy}m (threshold: ${MAX_ACCURACY_THRESHOLD}m)`);
        }
      },
      (error) => {
        // Silently fail - don't show error to user
        console.log('Geolocation watch error:', error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000, // Increased timeout to allow GPS to get a better fix
      }
    );

    // Cleanup on unmount
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [mapReady]);

  // Update user location marker and accuracy circle
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Remove existing user marker
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }

    // Remove existing accuracy circle
    if (map.current.getLayer('user-accuracy-circle')) {
      map.current.removeLayer('user-accuracy-circle');
    }
    if (map.current.getSource('user-accuracy')) {
      map.current.removeSource('user-accuracy');
    }

    if (userLocation) {
      // Create the blue pulsing dot marker with optional direction cone
      const el = document.createElement('div');
      el.className = 'user-location-marker';
      
      // Add direction cone if heading is available
      // Compensate for map rotation by subtracting map bearing
      const coneHtml = userHeading !== null 
        ? `<div class="user-location-cone" style="--heading: ${userHeading}deg; --map-bearing: ${mapBearing}deg"></div>`
        : '';
      
      el.innerHTML = `
        ${coneHtml}
        <div class="user-location-pulse"></div>
        <div class="user-location-dot"></div>
      `;

      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userLocation.lon, userLocation.lat])
        .addTo(map.current);

      // Add accuracy circle as a GeoJSON layer (capped at MAX_ACCURACY_CIRCLE_RADIUS)
      const circleRadius = Math.min(userLocation.accuracy, MAX_ACCURACY_CIRCLE_RADIUS);
      const circleGeoJSON = createCircleGeoJSON(
        userLocation.lon,
        userLocation.lat,
        circleRadius
      );

      map.current.addSource('user-accuracy', {
        type: 'geojson',
        data: circleGeoJSON,
      });

      map.current.addLayer({
        id: 'user-accuracy-circle',
        type: 'fill',
        source: 'user-accuracy',
        paint: {
          'fill-color': '#4285f4',
          'fill-opacity': 0.15,
        },
      });

      // Center map on first location received (one-time)
      if (!hasInitialCenterRef.current) {
        hasInitialCenterRef.current = true;
        map.current.flyTo({
          center: [userLocation.lon, userLocation.lat],
          zoom: 15,
          duration: 1000,
        });
      }
    }
  }, [userLocation, userHeading, mapBearing, mapReady]);

  // Search for the safest route
  const handleSearch = async () => {
    if (!origin || !destination || !spatialIndex) return;

    setRouteLoading(true);
    setRouteError(null);
    setSafestRoute(null);

    try {
      const orsRoutes = await getWalkingRoutes(origin, destination);
      
      if (orsRoutes.length === 0) {
        setRouteError('לא נמצא מסלול. נסה כתובות אחרות.');
        return;
      }

      // Use maximum safety weight (1.0) to get the safest route
      const scoredRoutes = scoreAndRankRoutes(orsRoutes, spatialIndex, 1.0);
      
      // Take only the safest route (first one after sorting)
      setSafestRoute(scoredRoutes[0]);
    } catch (error) {
      console.error('Route search failed:', error);
      setRouteError('שגיאה בחיפוש מסלול. נסה שוב.');
    } finally {
      setRouteLoading(false);
    }
  };

  // Select origin suggestion
  const handleSelectOriginSuggestion = (suggestion: AddressSuggestion) => {
    setOrigin({ lat: suggestion.lat, lon: suggestion.lon, address: suggestion.display });
    setOriginInput(suggestion.display);
    setShowOriginSuggestions(false);
    if (map.current) {
      map.current.flyTo({ center: [suggestion.lon, suggestion.lat], zoom: 15 });
    }
  };

  // Select destination suggestion
  const handleSelectDestSuggestion = (suggestion: AddressSuggestion) => {
    setDestination({ lat: suggestion.lat, lon: suggestion.lon, address: suggestion.display });
    setDestinationInput(suggestion.display);
    setShowDestSuggestions(false);
    if (map.current) {
      map.current.flyTo({ center: [suggestion.lon, suggestion.lat], zoom: 15 });
    }
  };

  // Handle origin input change
  const handleOriginInputChange = (value: string) => {
    setOriginInput(value);
    // Clear the selected origin when user starts typing again
    if (origin) {
      setOrigin(null);
    }
  };

  // Handle destination input change
  const handleDestInputChange = (value: string) => {
    setDestinationInput(value);
    // Clear the selected destination when user starts typing again
    if (destination) {
      setDestination(null);
    }
  };

  // Geocode origin address (fallback for Enter key)
  const handleOriginSearch = async () => {
    if (!originInput.trim()) return;

    try {
      const result = await geocodeAddress(originInput);
      if (result) {
        setOrigin(result);
        setShowOriginSuggestions(false);
        if (map.current) {
          map.current.flyTo({ center: [result.lon, result.lat], zoom: 15 });
        }
      }
    } catch (error) {
      console.error('Geocoding failed:', error);
    }
  };

  // Geocode destination address (fallback for Enter key)
  const handleDestinationSearch = async () => {
    if (!destinationInput.trim()) return;

    try {
      const result = await geocodeAddress(destinationInput);
      if (result) {
        setDestination(result);
        setShowDestSuggestions(false);
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
    setSafestRoute(null);
    setRouteError(null);
    setShowOriginSuggestions(false);
    setShowDestSuggestions(false);
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
        setOriginInput(address);
        
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

  // Route to a specific shelter from user's current location
  const routeToShelter = async (shelterLat: number, shelterLon: number, shelterAddress: string) => {
    if (!spatialIndex) {
      alert('המקלטים עדיין נטענים, נסה שוב');
      return;
    }

    setRouteLoading(true);
    setRouteError(null);
    setSafestRoute(null);

    const calculateRoute = async (userLat: number, userLon: number) => {
      try {
        // Set origin as current location
        const originAddress = await reverseGeocode(userLat, userLon);
        const originPoint: RoutePoint = { lat: userLat, lon: userLon, address: originAddress };
        setOrigin(originPoint);
        setOriginInput(originAddress);

        // Set destination as the shelter
        const destPoint: RoutePoint = {
          lat: shelterLat,
          lon: shelterLon,
          address: shelterAddress,
        };
        setDestination(destPoint);
        setDestinationInput(shelterAddress);

        // Get walking route
        const orsRoutes = await getWalkingRoutes(originPoint, destPoint);
        
        if (orsRoutes.length === 0) {
          setRouteError('לא נמצא מסלול למקלט. נסה שוב.');
          return;
        }

        // Score and set the route
        const scoredRoutes = scoreAndRankRoutes(orsRoutes, spatialIndex, 1.0);
        setSafestRoute(scoredRoutes[0]);

        // Expand panel if minimized
        setIsPanelMinimized(false);
      } catch (error) {
        console.error('Route to shelter failed:', error);
        setRouteError('שגיאה במציאת מסלול למקלט. נסה שוב.');
      } finally {
        setRouteLoading(false);
      }
    };

    // Use live location if available, otherwise request it
    if (userLocation) {
      await calculateRoute(userLocation.lat, userLocation.lon);
    } else {
      // Request location
      if (!navigator.geolocation) {
        alert('הדפדפן שלך לא תומך במיקום');
        setRouteLoading(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          await calculateRoute(latitude, longitude);
        },
        (error) => {
          console.error('Geolocation error:', error);
          alert('לא הצלחנו לקבל את המיקום שלך. אנא אפשר גישה למיקום.');
          setRouteLoading(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    }
  };

  // SOS - Find nearest shelter from current location
  const handleSOS = async () => {
    if (!spatialIndex) {
      alert('המקלטים עדיין נטענים, נסה שוב');
      return;
    }

    setSosLoading(true);
    setRouteError(null);
    setSafestRoute(null);

    const findAndRouteToNearest = async (lat: number, lon: number) => {
      // Find nearest shelter
      const nearestShelter = spatialIndex.getNearestShelter(lat, lon);
      
      if (!nearestShelter) {
        setRouteError('לא נמצא מקלט קרוב. נסה שוב.');
        setSosLoading(false);
        return;
      }

      // Use the shared routeToShelter function
      setSosLoading(false); // Let routeToShelter handle its own loading state
      await routeToShelter(nearestShelter.lat, nearestShelter.lon, nearestShelter.address);
    };

    // Use live location if available, otherwise request it
    if (userLocation) {
      await findAndRouteToNearest(userLocation.lat, userLocation.lon);
    } else {
      // Request location
      if (!navigator.geolocation) {
        alert('הדפדפן שלך לא תומך במיקום');
        setSosLoading(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          await findAndRouteToNearest(latitude, longitude);
        },
        (error) => {
          console.error('Geolocation error:', error);
          alert('לא הצלחנו לקבל את המיקום שלך. אנא אפשר גישה למיקום.');
          setSosLoading(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    }
  };

  return (
    <main style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {/* Map */}
      <div ref={mapContainer} className="map-container" />

      {/* Location button */}
      <button className={`location-btn ${isPanelMinimized ? 'panel-minimized' : ''}`} onClick={handleGetLocation} title="המיקום שלי">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
        </svg>
      </button>

      {/* SOS Button - Find nearest shelter */}
      <button
        className="sos-btn"
        onClick={handleSOS}
        disabled={sosLoading || sheltersLoading}
        title="מצא מקלט קרוב"
      >
        {sosLoading ? (
          <div className="spinner sos-spinner"></div>
        ) : (
          <>
            <span className="sos-icon">🆘</span>
            <span className="sos-text">מקלט קרוב</span>
          </>
        )}
      </button>

      {/* Control Panel */}
      <div className={`control-panel ${isPanelMinimized ? 'minimized' : ''}`}>
        <div className="panel-header">
          <div className="panel-header-content">
            <h1>🛡️ דרך צלחה</h1>
            {!isPanelMinimized && <p>מצא מסלול הליכה בטוח עם מקלטים</p>}
          </div>
          <button
            className="panel-toggle-btn"
            onClick={() => setIsPanelMinimized(!isPanelMinimized)}
            aria-label={isPanelMinimized ? 'הרחב פאנל' : 'מזער פאנל'}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              {isPanelMinimized ? (
                <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
              ) : (
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
              )}
            </svg>
          </button>
        </div>

        <div className={`panel-content ${isPanelMinimized ? 'hidden' : ''}`}>
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
                <div className="autocomplete-container">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="הקלד כתובת או לחץ על המפה"
                    value={originInput}
                    onChange={(e) => handleOriginInputChange(e.target.value)}
                    onFocus={() => setOriginFocused(true)}
                    onBlur={() => {
                      // Delay hiding to allow click on suggestion
                      setTimeout(() => {
                        setOriginFocused(false);
                        setShowOriginSuggestions(false);
                      }, 200);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleOriginSearch()}
                  />
                  {showOriginSuggestions && originSuggestions.length > 0 && (
                    <div className="autocomplete-dropdown">
                      {originSuggestions.map((suggestion, index) => (
                        <div
                          key={index}
                          className="autocomplete-item"
                          onClick={() => handleSelectOriginSuggestion(suggestion)}
                        >
                          {suggestion.display}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">יעד</label>
                <div className="autocomplete-container">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="הקלד כתובת או לחץ על המפה"
                    value={destinationInput}
                    onChange={(e) => handleDestInputChange(e.target.value)}
                    onFocus={() => setDestFocused(true)}
                    onBlur={() => {
                      // Delay hiding to allow click on suggestion
                      setTimeout(() => {
                        setDestFocused(false);
                        setShowDestSuggestions(false);
                      }, 200);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleDestinationSearch()}
                  />
                  {showDestSuggestions && destSuggestions.length > 0 && (
                    <div className="autocomplete-dropdown">
                      {destSuggestions.map((suggestion, index) => (
                        <div
                          key={index}
                          className="autocomplete-item"
                          onClick={() => handleSelectDestSuggestion(suggestion)}
                        >
                          {suggestion.display}
                        </div>
                      ))}
                    </div>
                  )}
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
                    '🔍 מצא מסלול בטוח'
                  )}
                </button>
                {(origin || destination) && (
                  <button className="btn btn-secondary" onClick={handleClear}>
                    נקה
                  </button>
                )}
              </div>

              {/* Route result - single safest route */}
              {safestRoute && (
                <div className="route-results" ref={routeResultsRef}>
                  <h3 style={{ fontSize: '0.875rem', marginBottom: '12px' }}>
                    🛡️ המסלול הבטוח ביותר
                  </h3>
                  <div className="route-card selected">
                    <div className="route-metrics">
                      <div className="metric">
                        <span className="metric-label">מרחק</span>
                        <span className="metric-value">
                          {safestRoute.metrics.distanceKm.toFixed(1)} ק״מ
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">זמן הליכה</span>
                        <span className="metric-value">
                          {Math.round(safestRoute.metrics.durationMinutes)} דק׳
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">מקלטים בדרך</span>
                        <span className="metric-value">{safestRoute.metrics.sheltersNearRoute}</span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">זמן הליכה למקלט</span>
                        <span className="metric-value">
                          {(() => {
                            // Case 1: No shelters near route at all
                            if (safestRoute.metrics.sheltersNearRoute === 0) {
                              return 'אין מקלט בטווח';
                            }
                            
                            const minDist = safestRoute.metrics.minDistanceToShelter;
                            const maxDist = safestRoute.metrics.maxGapToShelter;
                            
                            // Helper function to format time
                            const formatTime = (meters: number): string => {
                              const seconds = Math.round(meters / 1.4);
                              const minutes = Math.floor(seconds / 60);
                              const remainingSeconds = seconds % 60;
                              if (minutes === 0) {
                                return `${remainingSeconds} שנ׳`;
                              }
                              return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
                            };
                            
                            // Check for invalid values
                            if (!isFinite(minDist) || !isFinite(maxDist)) {
                              return 'לא זמין';
                            }
                            
                            const minTime = formatTime(minDist);
                            const maxTime = formatTime(maxDist);
                            
                            // If max is very long (>5 min), show warning
                            const maxSeconds = Math.round(maxDist / 1.4);
                            if (maxSeconds >= 300) {
                              return `${minTime} - +5 דק׳`;
                            }
                            
                            return `${minTime} - ${maxTime} דק׳`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
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

        {/* Credit - fixed footer */}
        {!isPanelMinimized && (
          <div className="panel-footer">
            <div className="credit">
              Made by{' '}
              <a
                href="https://www.linkedin.com/in/rom-bernheimer-9364b9174/"
                target="_blank"
                rel="noopener noreferrer"
                className="credit-link"
              >
                Rom Bernheimer
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
