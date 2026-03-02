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

// Panel height on mobile (55vh) - used for map padding calculations
const MOBILE_PANEL_HEIGHT_PERCENT = 0.55;
const MOBILE_BREAKPOINT = 768;

// Marker size configuration for zoom-adaptive sizing
const MARKER_BASE_ZOOM = 15;
const MARKER_BASE_SIZE = 20; // Base size at zoom 15
const MARKER_MIN_SIZE = 6;
const MARKER_MAX_SIZE = 28;
const MARKER_NEAR_ROUTE_MULTIPLIER = 1.4; // Near-route markers are 40% larger

// Calculate marker size based on zoom level
function calculateMarkerSize(zoom: number, isNearRoute: boolean = false): number {
  // Scale factor: ~1.15x per zoom level
  const scaleFactor = Math.pow(1.15, zoom - MARKER_BASE_ZOOM);
  let size = MARKER_BASE_SIZE * scaleFactor;
  
  // Apply near-route multiplier
  if (isNearRoute) {
    size *= MARKER_NEAR_ROUTE_MULTIPLIER;
  }
  
  // Clamp to min/max
  const minSize = isNearRoute ? MARKER_MIN_SIZE * MARKER_NEAR_ROUTE_MULTIPLIER : MARKER_MIN_SIZE;
  const maxSize = isNearRoute ? MARKER_MAX_SIZE * MARKER_NEAR_ROUTE_MULTIPLIER : MARKER_MAX_SIZE;
  
  return Math.max(minSize, Math.min(maxSize, Math.round(size)));
}

// Helper function to get map padding based on panel state
function getMapPadding(isPanelMinimized: boolean): maplibregl.PaddingOptions {
  // Only apply padding on mobile when panel is open
  if (typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT && !isPanelMinimized) {
    return { bottom: window.innerHeight * MOBILE_PANEL_HEIGHT_PERCENT, top: 0, left: 0, right: 0 };
  }
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

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
  const panelContentRef = useRef<HTMLDivElement>(null);

  // Live location tracking state
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [mapBearing, setMapBearing] = useState<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const hasInitialCenterRef = useRef(false);
  const hasAutoFilledOriginRef = useRef(false); // Track if origin was auto-filled on load
  
  // Compass heading state
  const [compassPermissionNeeded, setCompassPermissionNeeded] = useState(false);
  const lastHeadingRef = useRef<number | null>(null); // For smoothing
  const userConeRef = useRef<HTMLDivElement | null>(null); // Ref to cone element for direct updates

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
  const [isSosRoute, setIsSosRoute] = useState(false); // Track if current route is from SOS button
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM); // Track zoom for adaptive marker sizing
  
  // Store marker elements for zoom-based resizing (separate from maplibregl.Marker refs)
  const markerElementsRef = useRef<Map<string, { element: HTMLDivElement; isNearRoute: boolean }>>(new Map());

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

    // Track zoom for adaptive marker sizing
    map.current.on('zoom', () => {
      if (map.current) {
        setMapZoom(map.current.getZoom());
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

    // Clear existing markers and element refs
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    markerElementsRef.current.clear();

    // Filter shelters
    const filteredShelters = filterShelters(shelters, filters);

    // Get IDs of shelters near the route (if route exists)
    const nearbyShelterIds = new Set<string>(
      safestRoute?.nearbyShelters?.map(s => s.id) || []
    );

    // Get current zoom for initial marker sizing
    const currentZoom = map.current.getZoom();

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
      
      // Set initial size based on current zoom
      const size = calculateMarkerSize(currentZoom, isNearRoute);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      
      // Store reference for zoom-based resizing
      markerElementsRef.current.set(shelter.id, { element: el, isNearRoute });
      
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

  // Scroll panel content to top when panel is expanded
  useEffect(() => {
    if (!isPanelMinimized && panelContentRef.current) {
      panelContentRef.current.scrollTop = 0;
    }
  }, [isPanelMinimized]);

  // Update shelter marker sizes when zoom changes
  useEffect(() => {
    markerElementsRef.current.forEach(({ element, isNearRoute }) => {
      const size = calculateMarkerSize(mapZoom, isNearRoute);
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
    });
  }, [mapZoom]);

  // Start live location tracking when map is ready
  useEffect(() => {
    if (!mapReady || !map.current) return;
    if (!navigator.geolocation) return;

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        
        // Only update location if accuracy is good enough
        if (accuracy <= MAX_ACCURACY_THRESHOLD) {
          setUserLocation({ lat: latitude, lon: longitude, accuracy });
          // Note: We no longer use GPS heading here - compass heading comes from DeviceOrientationEvent
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

  // Compass heading from DeviceOrientationEvent (more reliable than GPS heading)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Smoothing function to reduce compass jitter
    const smoothHeading = (newHeading: number): number => {
      const lastHeading = lastHeadingRef.current;
      if (lastHeading === null) {
        lastHeadingRef.current = newHeading;
        return newHeading;
      }
      
      // Calculate the shortest angular distance
      let diff = newHeading - lastHeading;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      
      // Apply exponential smoothing (0.3 = more smoothing, 0.7 = less smoothing)
      const smoothingFactor = 0.3;
      let smoothed = lastHeading + diff * smoothingFactor;
      
      // Normalize to 0-360
      if (smoothed < 0) smoothed += 360;
      if (smoothed >= 360) smoothed -= 360;
      
      lastHeadingRef.current = smoothed;
      return smoothed;
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let heading: number | null = null;
      
      // iOS provides webkitCompassHeading (more accurate, already calibrated)
      // It gives the compass heading where 0 = North
      if ('webkitCompassHeading' in event && (event as any).webkitCompassHeading !== null) {
        heading = (event as any).webkitCompassHeading as number;
      } else if (event.alpha !== null) {
        // Android/others - alpha is the rotation around z-axis
        // alpha = 0 when device points in the same direction as during initialization
        // For compass heading: when alpha = 0, device points North
        // But alpha increases counter-clockwise, so we need to invert it
        heading = (360 - event.alpha) % 360;
      }
      
      if (heading !== null && !isNaN(heading) && isFinite(heading)) {
        const smoothedHeading = smoothHeading(heading);
        setUserHeading(smoothedHeading);
      }
    };

    // Check if we need to request permission (iOS 13+)
    const DeviceOrientationEventTyped = DeviceOrientationEvent as any;
    if (typeof DeviceOrientationEventTyped.requestPermission === 'function') {
      // iOS 13+ - need to request permission
      // This must be triggered by a user gesture, so we'll set a flag
      setCompassPermissionNeeded(true);
    } else {
      // Non-iOS or older iOS - just add listener directly
      window.addEventListener('deviceorientation', handleOrientation, true);
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  // Function to request compass permission (iOS)
  const requestCompassPermission = async () => {
    const DeviceOrientationEventTyped = DeviceOrientationEvent as any;
    if (typeof DeviceOrientationEventTyped.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEventTyped.requestPermission();
        if (permission === 'granted') {
          setCompassPermissionNeeded(false);
          
          // Smoothing function (duplicated here for the permission flow)
          const smoothHeading = (newHeading: number): number => {
            const lastHeading = lastHeadingRef.current;
            if (lastHeading === null) {
              lastHeadingRef.current = newHeading;
              return newHeading;
            }
            let diff = newHeading - lastHeading;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            const smoothingFactor = 0.3;
            let smoothed = lastHeading + diff * smoothingFactor;
            if (smoothed < 0) smoothed += 360;
            if (smoothed >= 360) smoothed -= 360;
            lastHeadingRef.current = smoothed;
            return smoothed;
          };

          const handleOrientation = (event: DeviceOrientationEvent) => {
            let heading: number | null = null;
            if ('webkitCompassHeading' in event && (event as any).webkitCompassHeading !== null) {
              heading = (event as any).webkitCompassHeading as number;
            } else if (event.alpha !== null) {
              heading = (360 - event.alpha) % 360;
            }
            if (heading !== null && !isNaN(heading) && isFinite(heading)) {
              const smoothedHeading = smoothHeading(heading);
              setUserHeading(smoothedHeading);
            }
          };

          window.addEventListener('deviceorientation', handleOrientation, true);
        }
      } catch (error) {
        console.error('Compass permission denied:', error);
      }
    }
  };

  // Update user location marker and accuracy circle (only when location changes)
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Remove existing user marker
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
      userConeRef.current = null;
    }

    // Remove existing accuracy circle
    if (map.current.getLayer('user-accuracy-circle')) {
      map.current.removeLayer('user-accuracy-circle');
    }
    if (map.current.getSource('user-accuracy')) {
      map.current.removeSource('user-accuracy');
    }

    if (userLocation) {
      // Create the blue pulsing dot marker with direction cone placeholder
      const el = document.createElement('div');
      el.className = 'user-location-marker';
      
      // Always create the cone element (hidden via CSS if no heading)
      const coneEl = document.createElement('div');
      coneEl.className = 'user-location-cone';
      coneEl.style.setProperty('--heading', '0deg');
      coneEl.style.setProperty('--map-bearing', '0deg');
      coneEl.style.display = 'none'; // Hidden until we have heading
      userConeRef.current = coneEl;
      
      el.appendChild(coneEl);
      
      const pulseEl = document.createElement('div');
      pulseEl.className = 'user-location-pulse';
      el.appendChild(pulseEl);
      
      const dotEl = document.createElement('div');
      dotEl.className = 'user-location-dot';
      el.appendChild(dotEl);

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
          padding: getMapPadding(isPanelMinimized),
        });
      }
    }
  }, [userLocation, mapReady]); // Removed userHeading and mapBearing from dependencies

  // Update direction cone rotation (separate from marker creation to avoid blinking)
  useEffect(() => {
    if (!userConeRef.current) return;
    
    if (userHeading !== null) {
      // Show the cone and update its rotation
      userConeRef.current.style.display = 'block';
      userConeRef.current.style.setProperty('--heading', `${userHeading}deg`);
      userConeRef.current.style.setProperty('--map-bearing', `${mapBearing}deg`);
    } else {
      // Hide the cone if no heading
      userConeRef.current.style.display = 'none';
    }
  }, [userHeading, mapBearing]);

  // Auto-fill origin with user's current location on first load
  useEffect(() => {
    // Only auto-fill once, when we get the first valid location
    if (
      userLocation &&
      !hasAutoFilledOriginRef.current &&
      !origin // Don't overwrite if user already set an origin
    ) {
      hasAutoFilledOriginRef.current = true;
      
      // Reverse geocode and set the origin
      (async () => {
        try {
          const address = await reverseGeocode(userLocation.lat, userLocation.lon);
          setOrigin({ lat: userLocation.lat, lon: userLocation.lon, address });
          setOriginInput(address);
        } catch (error) {
          console.error('Failed to auto-fill origin:', error);
          // Still mark as attempted so we don't retry
        }
      })();
    }
  }, [userLocation, origin]);

  // Search for the safest route
  const handleSearch = async () => {
    if (!origin || !destination || !spatialIndex) return;

    setRouteLoading(true);
    setRouteError(null);
    setSafestRoute(null);
    setIsSosRoute(false); // Regular route search, not SOS

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
      map.current.flyTo({ center: [suggestion.lon, suggestion.lat], zoom: 15, padding: getMapPadding(isPanelMinimized) });
    }
  };

  // Select destination suggestion
  const handleSelectDestSuggestion = (suggestion: AddressSuggestion) => {
    setDestination({ lat: suggestion.lat, lon: suggestion.lon, address: suggestion.display });
    setDestinationInput(suggestion.display);
    setShowDestSuggestions(false);
    if (map.current) {
      map.current.flyTo({ center: [suggestion.lon, suggestion.lat], zoom: 15, padding: getMapPadding(isPanelMinimized) });
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
          map.current.flyTo({ center: [result.lon, result.lat], zoom: 15, padding: getMapPadding(isPanelMinimized) });
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
          map.current.flyTo({ center: [result.lon, result.lat], zoom: 15, padding: getMapPadding(isPanelMinimized) });
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
          map.current.flyTo({ center: [longitude, latitude], zoom: 15, padding: getMapPadding(isPanelMinimized) });
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
    setIsSosRoute(true); // Mark this as an SOS route
    setIsPanelMinimized(true); // Close the panel automatically

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
    <main style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100vw', 
      height: '100dvh',
      overflow: 'hidden'
    }}>
      {/* Map */}
      <div ref={mapContainer} className="map-container" />

      {/* Location button */}
      <button className={`location-btn ${isPanelMinimized ? 'panel-minimized' : ''}`} onClick={handleGetLocation} title="המיקום שלי">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
        </svg>
      </button>

      {/* Compass permission button (iOS only) */}
      {compassPermissionNeeded && (
        <button
          className="compass-permission-btn"
          onClick={requestCompassPermission}
          title="אפשר גישה למצפן"
        >
          🧭 אפשר מצפן
        </button>
      )}

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

        <div ref={panelContentRef} className={`panel-content ${isPanelMinimized ? 'hidden' : ''}`}>
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
                    {isSosRoute ? '🆘 מסלול למקלט הקרוב' : '🛡️ המסלול הבטוח ביותר'}
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
                      {/* Only show shelters on the way for regular routes, not SOS */}
                      {!isSosRoute && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>
                  {/* Start Walking button */}
                  <button
                    className="btn btn-primary btn-full start-walking-btn"
                    onClick={() => {
                      // Close the panel
                      setIsPanelMinimized(true);
                      // Zoom to user location if available
                      // Use getMapPadding(true) since panel will be minimized
                      if (userLocation && map.current) {
                        map.current.flyTo({
                          center: [userLocation.lon, userLocation.lat],
                          zoom: 17,
                          duration: 1000,
                          padding: getMapPadding(true), // Panel will be minimized
                        });
                      } else if (origin && map.current) {
                        // Fallback to origin if no live location
                        map.current.flyTo({
                          center: [origin.lon, origin.lat],
                          zoom: 17,
                          duration: 1000,
                          padding: getMapPadding(true), // Panel will be minimized
                        });
                      }
                    }}
                  >
                    🚶 התחל הליכה
                  </button>
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
                href="https://github.com/TiManGames"
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
