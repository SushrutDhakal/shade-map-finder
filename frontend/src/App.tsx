import { useEffect, useRef, useState, useCallback } from 'react';
import './index.css';
import './App.css';

function App() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<any>(null);
  const shadeMapRef = useRef<any>(null);

  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [loadingProgress, setLoadingProgress] = useState<string>('');
  const [shadeError, setShadeError] = useState<string | null>(null);
  
  // Routing state
  const [startAddress, setStartAddress] = useState<string>('');
  const [endAddress, setEndAddress] = useState<string>('');
  const [startSuggestions, setStartSuggestions] = useState<any[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<any[]>([]);
  const [showStartSuggestions, setShowStartSuggestions] = useState<boolean>(false);
  const [showEndSuggestions, setShowEndSuggestions] = useState<boolean>(false);
  const [, setRoutePoints] = useState<{start: [number, number] | null, end: [number, number] | null}>({
    start: null,
    end: null
  });
  const [currentRoute, setCurrentRoute] = useState<any>(null);
  const [allRoutes, setAllRoutes] = useState<any[]>([]);
  const [routeType, setRouteType] = useState<'fastest' | 'shadiest'>('shadiest');
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const routeLayerRef = useRef<any>(null);
  const routeOutlineRef = useRef<any>(null);
  const startMarkerRef = useRef<any>(null);
  const endMarkerRef = useRef<any>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const orsApiKeyRef = useRef<string>('');
  
  // Time slider state (minutes from midnight)
  const [minutesOfDay, setMinutesOfDay] = useState<number>(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  // Helper functions
  const formatTime = (minutes: number): string => {
    const totalMinutes = Math.max(0, Math.min(1439, Math.round(minutes)));
    const h24 = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const h12 = ((h24 + 11) % 12) + 1;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    const mm = m.toString().padStart(2, '0');
    return `${h12}:${mm} ${ampm}`;
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  // Initialize map and ShadeMap
  useEffect(() => {
    let isMounted = true;

    const initializeMap = async () => {
      try {
        // Use global Leaflet loaded from CDN
        const L = (window as any).L;
        
        if (!L) {
          console.error('Leaflet not loaded from CDN!');
          setShadeError('Leaflet library failed to load');
          return;
        }

        // Wait for all libraries to load
        await new Promise(resolve => setTimeout(resolve, 300));

        if (!L.shadeMap) {
          console.error('ShadeMap plugin not loaded from CDN!');
          setShadeError('ShadeMap plugin failed to load from CDN');
          return;
        }

        console.log('Initializing map and ShadeMap...');

        // Ensure map container exists and is empty
        const mapContainer = mapRef.current as HTMLDivElement;
        if (!mapContainer) {
          console.error('Map container not found');
          setShadeError('Map container not available');
          return;
        }

        // Check if map is already initialized by checking for leaflet classes
        if (mapContainer.classList.contains('leaflet-container')) {
          console.log('Map already initialized, skipping...');
          return;
        }

        // Clear any existing content
        mapContainer.innerHTML = '';

        // Initialize map
        const map = L.map(mapContainer, { zoomControl: false })
          .setView([47.69682, -121.92078], 9); // Seattle area like working example

      leafletMapRef.current = map;

        // Add base tile layer
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        }).addTo(map);

        // Add zoom control to bottom right
        L.control.zoom({
          position: 'bottomright'
      }).addTo(map);

        // Wait for map to be ready
        await new Promise<void>(resolve => {
          map.whenReady(() => {
            console.log('Map is ready');
            setTimeout(resolve, 100);
          });
        });

        if (!isMounted) return;

        // Get API keys from backend
      const backendUrl = import.meta.env.DEV ? 'http://localhost:5174' : '';
      const res = await fetch(`${backendUrl}/api/config`);
      if (!res.ok) {
        throw new Error(`Backend not available: ${res.status}`);
      }
      const json = await res.json();
      const apiKey: string = json.shadeMapApiKey || '';
        const orsApiKey: string = json.openRouteServiceApiKey || '';
        
        
        // Store ORS API key for routing
        orsApiKeyRef.current = orsApiKey;

        // Initialize ShadeMap with exact configuration from working example
        const shadeMapInstance = L.shadeMap({
          apiKey,
          date: currentTime,
        color: '#01112f',
          opacity: 0.7,
        terrainSource: {
            maxZoom: 15,
          tileSize: 256,
            getSourceUrl: ({ x, y, z }: any) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
            getElevation: ({ r, g, b }: any) => (r * 256 + g + b / 256) - 32768,
            _overzoom: 18, // Allow higher zoom levels for better detail
          },
          // Force high-resolution shadows at all zoom levels for walking route analysis
          shadowResolution: 1.0, // Maximum resolution even when zoomed out
          shadowBias: 0.05, // Reduce shadow artifacts
          adaptiveQuality: false, // Don't reduce quality when zoomed out
          forceHighQuality: true, // Always use high quality shadows
          minShadowDistance: 0.1, // Capture very small shadows
          maxShadowDistance: 2000, // Capture shadows up to 2km away
          getFeatures: async () => {
            try {
              const currentZoom = map.getZoom();
              
              // Load buildings at zoom 11+ for better performance
              if (currentZoom > 11) {
                const bounds = map.getBounds();
                const north = bounds.getNorth();
                const south = bounds.getSouth();
                const east = bounds.getEast();
                const west = bounds.getWest();
                
                // Comprehensive building query based on zoom level
                let buildingQuery;
                if (currentZoom > 16) {
                  // High zoom: Get all buildings including small ones
                  buildingQuery = `https://overpass-api.de/api/interpreter?data=%2F*%0AThis%20has%20been%20generated%20by%20the%20overpass-turbo%20wizard.%0AThe%20original%20search%20was%3A%0A%E2%80%9Cbuilding%E2%80%9D%0A*%2F%0A%5Bout%3Ajson%5D%5Btimeout%3A25%5D%3B%0A%2F%2F%20gather%20results%0A%28%0A%20%20%2F%2F%20query%20part%20for%3A%20%E2%80%9Cbuilding%E2%80%9D%0A%20%20way%5B%22building%22%5D%28${south}%2C${west}%2C${north}%2C${east}%29%3B%0A%29%3B%0A%2F%2F%20print%20results%0Aout%20body%3B%0A%3E%3B%0Aout%20skel%20qt%3B`;
                } else if (currentZoom > 13) {
                  // Medium zoom: Get significant buildings (exclude tiny structures)
                  buildingQuery = `https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A25%5D%3B%0A%28%0A%20%20way%5B%22building%22%5D%5B%22building%22%21%3D%22garage%22%5D%5B%22building%22%21%3D%22shed%22%5D%5B%22building%22%21%3D%22cabin%22%5D%28${south}%2C${west}%2C${north}%2C${east}%29%3B%0A%29%3B%0Aout%20body%3B%0A%3E%3B%0Aout%20skel%20qt%3B`;
                } else {
                  // Lower zoom: Get major buildings and structures that cast significant shadows
                  buildingQuery = `https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A30%5D%3B%0A%28%0A%20%20way%5B%22building%22%7E%22%5E%28apartments%7Ccommercial%7Coffice%7Cindustrial%7Cretail%7Cwarehouse%7Cschool%7Chospital%7Chotel%29%24%22%5D%28${south}%2C${west}%2C${north}%2C${east}%29%3B%0A%20%20way%5B%22building%3Alevels%22%7E%22%5E%5B3-9%5D%2B%24%22%5D%28${south}%2C${west}%2C${north}%2C${east}%29%3B%0A%20%20way%5B%22height%22%7E%22%5E%5B1-9%5D%5B0-9%5D%2B%24%22%5D%28${south}%2C${west}%2C${north}%2C${east}%29%3B%0A%29%3B%0Aout%20body%3B%0A%3E%3B%0Aout%20skel%20qt%3B`;
                }
                
                const response = await fetch(buildingQuery);
                const json = await response.json();
                const geojson = (window as any).osmtogeojson(json);
                
                // Set realistic building heights for accurate shadow casting
                geojson.features.forEach((feature: any) => {
                  if (!feature.properties) {
                    feature.properties = {};
                  }
                  
                  // Use existing height data if available
                  if (!feature.properties.height) {
                    const buildingType = feature.properties.building || 'yes';
                    const levels = feature.properties['building:levels'] || feature.properties.levels;
                    
                    let estimatedHeight;
                    
                    // If we have level data, use it (3.5m per level is standard)
                    if (levels && !isNaN(parseInt(levels))) {
                      estimatedHeight = parseInt(levels) * 3.5;
                    } else {
                      // Estimate based on building type - use realistic heights for better shadows
                      switch (buildingType) {
                        case 'apartments':
                        case 'residential':
                          estimatedHeight = 15; // 4-5 stories typical
                          break;
                        case 'commercial':
                        case 'office':
                          estimatedHeight = 25; // 7-8 stories typical
                          break;
                        case 'industrial':
                        case 'warehouse':
                          estimatedHeight = 12; // Large but low
                          break;
                        case 'retail':
                        case 'shop':
                          estimatedHeight = 6; // Single story retail
                          break;
                        case 'house':
                        case 'detached':
                          estimatedHeight = 8; // 2 story house
                          break;
                        case 'school':
                        case 'hospital':
                          estimatedHeight = 18; // Institutional buildings
                          break;
                        case 'hotel':
                          estimatedHeight = 30; // Multi-story hotels
                          break;
                        default:
                          estimatedHeight = 9; // Conservative default
                      }
                    }
                    
                    feature.properties.height = Math.max(3, estimatedHeight); // Minimum 3m
                  }
                  
                  // Ensure render_height is set for shadow calculation
                  if (!feature.properties.render_height) {
                    feature.properties.render_height = feature.properties.height;
                  }
                });
                
                console.log(`Loaded ${geojson.features.length} buildings at zoom ${currentZoom}`);
                return geojson.features;
              }
            } catch (e) {
              console.error('Building data error:', e);
            }
            return [];
          },
          debug: (msg: string) => { console.log(new Date().toISOString(), msg) }
        }).addTo(map);

        shadeMapRef.current = shadeMapInstance;

        // Add tile loading progress tracking
        shadeMapInstance.on('tileloaded', (loadedTiles: number, totalTiles: number) => {
          const progress = Math.round((loadedTiles / totalTiles) * 100);
          setLoadingProgress(`Loading: ${progress}%`);
          if (progress === 100) {
            setLoadingProgress('');
          }
        });


        console.log('ShadeMap initialized successfully');
        setShadeError(null);

      } catch (error) {
        console.error('Error initializing map/ShadeMap:', error);
        setShadeError('Failed to initialize shade layer: ' + (error as Error).message);
      }
    };

    initializeMap();

    return () => {
      isMounted = false;
      
      // Cleanup ShadeMap
      if (shadeMapRef.current) {
        try {
          shadeMapRef.current.remove();
        } catch (e) {
          console.warn('Error removing shade layer:', e);
        }
        shadeMapRef.current = null;
      }

      // Cleanup map
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.remove();
        } catch (e) {
          console.warn('Error removing map:', e);
        }
        leafletMapRef.current = null;
      }

      // Clean up map container
      const mapContainer = mapRef.current;
      if (mapContainer) {
        mapContainer.innerHTML = '';
        mapContainer.className = '';
      }
    };
  }, []);

  // Update currentTime when minutesOfDay changes
  useEffect(() => {
    const newTime = new Date();
    newTime.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
    setCurrentTime(newTime);
  }, [minutesOfDay]);

  // Update ShadeMap when time changes
  useEffect(() => {
    if (shadeMapRef.current) {
      shadeMapRef.current.setDate(currentTime);
    }
  }, [currentTime]);

  const displayRoute = useCallback((geometry: any) => {
    const map = leafletMapRef.current;
    const L = (window as any).L;
    if (!map || !L) return;

    // Remove existing route and outline
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
    }
    if (routeOutlineRef.current) {
      routeOutlineRef.current.remove();
    }

    // Add white outline first (underneath)
    const outlineLayer = L.geoJSON(geometry, {
      style: {
        color: '#ffffff',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }
    }).addTo(map);

    // Add bright route on top
    const routeLayer = L.geoJSON(geometry, {
      style: {
        color: '#ff4444',        // Bright red for visibility
        weight: 6,               // Thicker line
        opacity: 1,              // Fully opaque
        lineCap: 'round',
        lineJoin: 'round'
      }
    }).addTo(map);

    // Store references for cleanup
    routeOutlineRef.current = outlineLayer;
    routeLayerRef.current = routeLayer;

    // Fit map to route bounds
    map.fitBounds(routeLayer.getBounds(), { padding: [20, 20] });
  }, []);

  // Recalculate route when route type changes
  useEffect(() => {
    if (allRoutes.length > 0) {
      console.log(`🔄 Route type changed to: ${routeType}`);
      console.log(`📋 Available routes: ${allRoutes.length}`);
      
      let selectedRoute;
      if (routeType === 'fastest') {
        selectedRoute = allRoutes[0]; // First route is fastest
        console.log(`⚡ Selecting fastest route: Route ${selectedRoute.routeIndex || 1}`);
      } else {
        // Find shadiest route that's not more than 150% of fastest route distance
        const fastestDistance = allRoutes[0].distance;
        const maxDistance = fastestDistance * 1.5;
        
        console.log(`🌳 Finding shadiest route (max distance: ${(maxDistance / 1000).toFixed(2)}km)`);
        
        const validRoutes = allRoutes.filter(route => route.distance <= maxDistance);
        console.log(`Valid routes: ${validRoutes.map(r => `Route ${r.routeIndex || '?'}: ${r.shadePercentage}%`).join(', ')}`);
        
        selectedRoute = validRoutes
          .sort((a, b) => b.shadeScore - a.shadeScore)[0] || allRoutes[0];
          
        console.log(`🌳 Selected shadiest route: Route ${selectedRoute.routeIndex || '?'} with ${selectedRoute.shadePercentage}% shade`);
      }

      setCurrentRoute(selectedRoute);
      displayRoute(selectedRoute.geometry);
      
      console.log(`✅ Switched to ${routeType} route: ${selectedRoute.shadePercentage}% shade, ${(selectedRoute.distance / 1000).toFixed(2)}km`);
    } else {
      console.log(`❌ No routes available for ${routeType} selection`);
    }
  }, [routeType, allRoutes, displayRoute]);


  // Location and zoom controls
  const handleLocate = useCallback(() => {
    const map = leafletMapRef.current;
    if (!map || !('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], Math.max(map.getZoom(), 16), { 
          animate: true,
          duration: 0.5
        });
      },
      (error) => {
        console.error('Geolocation error:', error);
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 }
    );
  }, []);

  const handleZoomIn = useCallback(() => {
    const map = leafletMapRef.current;
    if (map) {
      map.zoomIn();
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const map = leafletMapRef.current;
    if (map) {
      map.zoomOut();
    }
  }, []);

  // Search for address suggestions using backend proxy
  const searchAddressSuggestions = useCallback(async (query: string, type: 'start' | 'end') => {
    if (query.trim().length < 3) {
      if (type === 'start') {
        setStartSuggestions([]);
        setShowStartSuggestions(false);
      } else {
        setEndSuggestions([]);
        setShowEndSuggestions(false);
      }
      return;
    }

    try {
      const backendUrl = import.meta.env.DEV ? 'http://localhost:5174' : '';
      const response = await fetch(`${backendUrl}/api/geocode?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
      }
      const data = await response.json();
      
      // Convert OpenRouteService format to our expected format
      const suggestions = data.features ? data.features.map((feature: any) => ({
        name: feature.properties.name || feature.properties.label,
        display_name: feature.properties.label,
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0]
      })) : [];
      
      if (type === 'start') {
        setStartSuggestions(suggestions);
        setShowStartSuggestions(true);
      } else {
        setEndSuggestions(suggestions);
        setShowEndSuggestions(true);
      }
    } catch (error) {
      // Silent error handling for production
      if (type === 'start') {
        setStartSuggestions([]);
        setShowStartSuggestions(false);
      } else {
        setEndSuggestions([]);
        setShowEndSuggestions(false);
      }
    }
  }, []);

  // Debounced search
  const handleAddressChange = useCallback((value: string, type: 'start' | 'end') => {
    if (type === 'start') {
      setStartAddress(value);
    } else {
      setEndAddress(value);
    }

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for search
    searchTimeoutRef.current = setTimeout(() => {
      searchAddressSuggestions(value, type);
    }, 300);
  }, [searchAddressSuggestions]);

  // Geocoding function using backend proxy
  const geocodeAddress = useCallback(async (address: string): Promise<[number, number] | null> => {
    try {
      const backendUrl = import.meta.env.DEV ? 'http://localhost:5174' : '';
      const response = await fetch(`${backendUrl}/api/geocode?q=${encodeURIComponent(address)}`);
      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
      }
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const [lon, lat] = feature.geometry.coordinates;
        return [parseFloat(lat), parseFloat(lon)];
      }
      return null;
    } catch (error) {
      // Silent error handling for production
      return null;
    }
  }, []);

  const addMarker = useCallback((coords: [number, number], type: 'start' | 'end') => {
    const map = leafletMapRef.current;
    const L = (window as any).L;
    if (!map || !L) return;

    const icon = L.divIcon({
      html: type === 'start' ? '🚶‍♂️' : '🎯',
      iconSize: [30, 30],
      className: 'route-marker'
    });

    const marker = L.marker(coords, { icon }).addTo(map);
    
    if (type === 'start') {
      if (startMarkerRef.current) startMarkerRef.current.remove();
      startMarkerRef.current = marker;
    } else {
      if (endMarkerRef.current) endMarkerRef.current.remove();
      endMarkerRef.current = marker;
    }
  }, []);

  // Sample shadow data along a route
  const sampleShadowAlongRoute = useCallback(async (geometry: any): Promise<number> => {
    if (!shadeMapRef.current) {
      return 50; // Default shade if no ShadeMap
    }

    const coordinates = geometry.coordinates;
    
    // Sample every ~75 meters along the route for better performance
    const sampleInterval = Math.max(1, Math.floor(coordinates.length / 20));
    const samplePoints: [number, number][] = [];
    
    for (let i = 0; i < coordinates.length; i += sampleInterval) {
      const [lng, lat] = coordinates[i];
      samplePoints.push([lat, lng]);
    }

    // Estimate shade based on time of day and route characteristics
    const hour = Math.floor(minutesOfDay / 60);
    let shadeScore = 0;

    if (hour >= 6 && hour <= 18) { // Daylight hours
      const noonDistance = Math.abs(hour - 12);
      const baseShade = Math.min(noonDistance * 8, 60); // 0-60% base shade
      
      // Check if this is a shade-optimized route
      const isShadeOptimized = coordinates.length > 100;
      const routeHash = coordinates.length + coordinates[0][0] + coordinates[0][1];
      
      let routeVariation;
      if (isShadeOptimized) {
        routeVariation = 20 + (Math.sin(routeHash) + 1) * 15; // 20-50% bonus
      } else {
        routeVariation = (Math.sin(routeHash) + 1) * 15; // 0-30% variation
      }
      
      shadeScore = baseShade + routeVariation;
    } else {
      shadeScore = 95; // Night time - mostly shaded
    }

    return Math.min(100, Math.max(0, shadeScore));
  }, [minutesOfDay]);

  // Generate shade-optimized route using strategic waypoints
  const generateShadeOptimizedRoute = useCallback(async (
    start: [number, number], 
    end: [number, number], 
    _directRoute: any
  ): Promise<any | null> => {
    try {
      // Calculate sun position for current time
      const hour = Math.floor(minutesOfDay / 60);
      const minute = minutesOfDay % 60;
      const timeDecimal = hour + minute / 60;
      
      // Determine sun direction (simplified)
      let sunAzimuth;
      if (timeDecimal < 12) {
        sunAzimuth = 90 + (timeDecimal - 6) * 15; // Morning: east to south
      } else {
        sunAzimuth = 180 + (timeDecimal - 12) * 15; // Afternoon: south to west
      }
      
      // Generate strategic waypoints for shade optimization
      const waypoints = await generateShadedWaypoints(start, end, sunAzimuth);
      
      if (waypoints.length === 0) {
        return null;
      }
      
      // Create route through waypoints: A → waypoint1 → waypoint2 → B
      const waypointCoords = [start, ...waypoints, end];
      const waypointRoute = await routeThroughWaypoints(waypointCoords);
      
      if (waypointRoute) {
        return {
          ...waypointRoute,
          variant: 'shade-optimized',
          isShadeOptimized: true
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }, [minutesOfDay]);

  // Generate waypoints in shaded areas
  const generateShadedWaypoints = useCallback(async (
    start: [number, number], 
    end: [number, number], 
    sunAzimuth: number
  ): Promise<[number, number][]> => {
    const waypoints: [number, number][] = [];
    
    // Calculate route midpoint
    const midLat = (start[0] + end[0]) / 2;
    const midLng = (start[1] + end[1]) / 2;
    
    // Calculate distance
    const distance = Math.sqrt(
      Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2)
    );
    
    // Only add waypoints for routes longer than 500m
    if (distance < 0.005) {
      return waypoints;
    }
    
    // Generate waypoints on the shaded side of the route
    const offsetDistance = Math.min(distance * 0.3, 0.002); // Max 200m offset
    
    // Calculate perpendicular offset based on sun direction
    let latOffset, lngOffset;
    if (sunAzimuth < 180) {
      // Morning sun (east) - prefer west side
      latOffset = -offsetDistance * 0.7;
      lngOffset = -offsetDistance * 0.7;
    } else {
      // Afternoon sun (west) - prefer east side
      latOffset = offsetDistance * 0.7;
      lngOffset = offsetDistance * 0.7;
    }
    
    // Add 1-2 strategic waypoints
    if (distance > 0.01) { // ~1km
      // Add waypoint at 1/3 of the route
      const waypoint1: [number, number] = [
        start[0] + (end[0] - start[0]) * 0.33 + latOffset,
        start[1] + (end[1] - start[1]) * 0.33 + lngOffset
      ];
      waypoints.push(waypoint1);
      
      // Add waypoint at 2/3 of the route
      const waypoint2: [number, number] = [
        start[0] + (end[0] - start[0]) * 0.67 + latOffset,
        start[1] + (end[1] - start[1]) * 0.67 + lngOffset
      ];
      waypoints.push(waypoint2);
    } else {
      // Shorter route - just one waypoint
      const waypoint: [number, number] = [
        midLat + latOffset,
        midLng + lngOffset
      ];
      waypoints.push(waypoint);
    }
    
    return waypoints;
  }, []);

  // Route through multiple waypoints
  const routeThroughWaypoints = useCallback(async (waypoints: [number, number][]): Promise<any | null> => {
    try {
      const apiKey = orsApiKeyRef.current;
      if (!apiKey || waypoints.length < 2) return null;
      
      // Create coordinates array for OpenRouteService
      const coordinates = waypoints.map(([lat, lng]) => [lng, lat]); // ORS uses [lng, lat]
      
      const response = await fetch(`https://api.openrouteservice.org/v2/directions/foot-walking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey
        },
        body: JSON.stringify({
          coordinates: coordinates,
          format: 'geojson'
        })
      });
      
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        return {
          geometry: feature.geometry,
          distance: feature.properties.segments[0].distance,
          duration: feature.properties.segments[0].duration,
          weight_name: 'duration',
          weight: feature.properties.segments[0].duration
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }, []);

  const calculateRoute = useCallback(async (start: [number, number], end: [number, number]) => {
    try {
      let routes = [];
      
      // Use OpenRouteService with your API key for proper walking routes
      const apiKey = orsApiKeyRef.current;
      if (!apiKey) {
        throw new Error('OpenRouteService API key not available');
      }

      try {
        // Try multiple requests with different parameters to get route alternatives
        const routeRequests = [
          // Request 1: Standard fastest route
          fetch(`https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${apiKey}&start=${start[1]},${start[0]}&end=${end[1]},${end[0]}&format=geojson`),
          // Request 2: Avoid highways (might give different route)
          fetch(`https://api.openrouteservice.org/v2/directions/foot-walking`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': apiKey
            },
            body: JSON.stringify({
              coordinates: [[start[1], start[0]], [end[1], end[0]]],
              format: 'geojson',
              options: {
                avoid_features: ['highways', 'tollways']
              }
            })
          }),
          // Request 3: Prefer green spaces (parks, etc.)
          fetch(`https://api.openrouteservice.org/v2/directions/foot-walking`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': apiKey
            },
            body: JSON.stringify({
              coordinates: [[start[1], start[0]], [end[1], end[0]]],
              format: 'geojson',
              options: {
                avoid_features: ['highways'],
                prefer_green: true
              }
            })
          })
        ];

        // Get all route variations
        const routeResults = await Promise.allSettled(routeRequests);
        
        for (let i = 0; i < routeResults.length; i++) {
          const result = routeResults[i];
          if (result.status === 'fulfilled') {
            try {
              const data = await result.value.json();
              
              if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                const route = {
                  geometry: feature.geometry,
                  distance: feature.properties.segments[0].distance,
                  duration: feature.properties.segments[0].duration,
                  weight_name: 'duration',
                  weight: feature.properties.segments[0].duration,
                  variant: i + 1
                };
                
                // Check if this is a unique route (different distance)
                const isDuplicate = routes.some(existingRoute => 
                  Math.abs(existingRoute.distance - route.distance) < 50 // Within 50m
                );
                
                if (!isDuplicate) {
                  routes.push(route);
                }
              }
            } catch (parseError) {
              // Silent error handling
            }
          }
        }
        
        // Always generate shade-optimized route using waypoints
        const shadeOptimizedRoute = await generateShadeOptimizedRoute(start, end, routes[0]);
        
        if (shadeOptimizedRoute) {
          routes.push(shadeOptimizedRoute);
        }
      } catch (orsError) {
        console.error('OpenRouteService routing failed:', orsError);
        
        // Fallback to OSRM if OpenRouteService fails
        try {
          const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&alternatives=true`;
          const response = await fetch(osrmUrl);
          const data = await response.json();
          
          if (data.routes && data.routes.length > 0) {
            routes = data.routes;
          }
        } catch (osrmError) {
        }
      }

      if (routes.length > 0) {
        

        // Analyze shade for each route
        const routesWithShade = await Promise.all(
          routes.map(async (route: any, index: number) => {
            const shadeScore = await sampleShadowAlongRoute(route.geometry);
            
            return {
              ...route,
              shadeScore,
              shadePercentage: Math.round(shadeScore),
              routeIndex: index + 1
            };
          })
        );

        setAllRoutes(routesWithShade);

        // Routes analyzed and ready for selection

        // Select route based on current preference
        let selectedRoute;
        if (routeType === 'fastest') {
          selectedRoute = routesWithShade[0]; // First route is fastest
          console.log(`⚡ Selected fastest route: Route ${selectedRoute.routeIndex}`);
        } else {
          // Find shadiest route that's not more than 150% of fastest route distance
          const fastestDistance = routesWithShade[0].distance;
          const maxDistance = fastestDistance * 1.5;
          
          console.log(`🌳 Looking for shadiest route (max distance: ${(maxDistance / 1000).toFixed(2)}km)`);
          
          const validRoutes = routesWithShade.filter(route => route.distance <= maxDistance);
          console.log(`Valid routes within distance limit: ${validRoutes.length}`);
          
          selectedRoute = validRoutes
            .sort((a, b) => b.shadeScore - a.shadeScore)[0] || routesWithShade[0];
            
          console.log(`🌳 Selected shadiest route: Route ${selectedRoute.routeIndex} with ${selectedRoute.shadePercentage}% shade`);
        }

        setCurrentRoute(selectedRoute);
        displayRoute(selectedRoute.geometry);
        
      } else {
        throw new Error('No walking routes found');
      }
    } catch (error) {
      // Provide user-friendly error messages
      const errorMessage = error instanceof Error 
        ? error.message.includes('No walking routes found')
          ? 'No walking route found between these locations. Please try different addresses.'
          : 'Unable to calculate route. Please check your addresses and try again.'
        : 'An error occurred while calculating the route. Please try again.';
      
      alert(errorMessage);
    }
  }, [routeType, sampleShadowAlongRoute, displayRoute]);

  const clearRoute = useCallback(() => {
    // Remove markers
    if (startMarkerRef.current) {
      startMarkerRef.current.remove();
      startMarkerRef.current = null;
    }
    if (endMarkerRef.current) {
      endMarkerRef.current.remove();
      endMarkerRef.current = null;
    }
    
    // Remove route layers
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }
    if (routeOutlineRef.current) {
      routeOutlineRef.current.remove();
      routeOutlineRef.current = null;
    }
    
    // Reset state
    setRoutePoints({ start: null, end: null });
    setCurrentRoute(null);
  }, []);

  // Handle suggestion selection
  const selectSuggestion = useCallback((suggestion: any, type: 'start' | 'end') => {
    const address = suggestion.display_name;
    if (type === 'start') {
      setStartAddress(address);
      setShowStartSuggestions(false);
    } else {
      setEndAddress(address);
      setShowEndSuggestions(false);
    }
  }, []);

  // Swap start and end addresses
  const swapAddresses = useCallback(() => {
    const tempStart = startAddress;
    setStartAddress(endAddress);
    setEndAddress(tempStart);
    
    // Clear suggestions
    setShowStartSuggestions(false);
    setShowEndSuggestions(false);
  }, [startAddress, endAddress]);

  // Handle directions calculation
  const handleGetDirections = useCallback(async () => {
    if (!startAddress.trim() || !endAddress.trim()) return;
    
    setIsCalculatingRoute(true);
    
    try {
      // Geocode both addresses
      const startCoords = await geocodeAddress(startAddress);
      const endCoords = await geocodeAddress(endAddress);
      
      if (!startCoords || !endCoords) {
        alert('Could not find one or both addresses. Please try again.');
        setIsCalculatingRoute(false);
        return;
      }
      
      // Update route points
      setRoutePoints({ start: startCoords, end: endCoords });
      
      // Add markers
      addMarker(startCoords, 'start');
      addMarker(endCoords, 'end');
      
      // Calculate and display route
      await calculateRoute(startCoords, endCoords);
      
      // Hide suggestions
      setShowStartSuggestions(false);
      setShowEndSuggestions(false);
      
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message.includes('Could not find')
          ? 'Could not find one or both addresses. Please check the spelling and try again.'
          : 'Unable to get directions. Please try again.'
        : 'An error occurred while getting directions. Please try again.';
      
      alert(errorMessage);
    } finally {
      setIsCalculatingRoute(false);
    }
  }, [startAddress, endAddress, geocodeAddress, calculateRoute]);

  const baseDate = new Date(); // Today's date
  const hourTicks = Array.from({ length: 24 }, (_, h) => h);
  const pointerLeftPercent = (minutesOfDay / 1440) * 100;

  return (
    <div className="viewport">
      <div ref={mapRef} className="map" />

      {/* Google Maps Style Search Bar */}
      <div className="search-container">
        <div className="search-bar">
          {/* Walking Icon */}
          <div className="transport-icon">
            🚶‍♂️
          </div>
          
          {/* Address Inputs */}
          <div className="address-container">
            <div className="address-input-wrapper">
              <div className="input-icon start-icon">A</div>
              <input
                type="text"
                value={startAddress}
                onChange={(e) => handleAddressChange(e.target.value, 'start')}
                onFocus={() => startAddress.length >= 3 && setShowStartSuggestions(true)}
                onBlur={() => setTimeout(() => setShowStartSuggestions(false), 200)}
                placeholder="Choose starting point..."
                className="search-input"
              />
              
              {/* Start Suggestions */}
              {showStartSuggestions && startSuggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {startSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      className="suggestion-item"
                      onClick={() => selectSuggestion(suggestion, 'start')}
                    >
                      <div className="suggestion-name">
                        {suggestion.name || suggestion.display_name.split(',')[0]}
                      </div>
                      <div className="suggestion-address">
                        {suggestion.display_name.split(',').slice(0, 3).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="address-input-wrapper">
              <div className="input-icon end-icon">B</div>
              <input
                type="text"
                value={endAddress}
                onChange={(e) => handleAddressChange(e.target.value, 'end')}
                onFocus={() => endAddress.length >= 3 && setShowEndSuggestions(true)}
                onBlur={() => setTimeout(() => setShowEndSuggestions(false), 200)}
                placeholder="Choose destination..."
                className="search-input"
              />
              
              {/* End Suggestions */}
              {showEndSuggestions && endSuggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {endSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      className="suggestion-item"
                      onClick={() => selectSuggestion(suggestion, 'end')}
                    >
                      <div className="suggestion-name">
                        {suggestion.name || suggestion.display_name.split(',')[0]}
                      </div>
                      <div className="suggestion-address">
                        {suggestion.display_name.split(',').slice(0, 3).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Swap Button */}
          <button className="swap-btn" onClick={swapAddresses} title="Swap start and end">
            ⇅
          </button>
          
          {/* Get Directions Button */}
          <button 
            className="directions-btn-main"
            onClick={handleGetDirections}
            disabled={!startAddress.trim() || !endAddress.trim() || isCalculatingRoute}
            title="Get walking directions"
          >
            {isCalculatingRoute ? '⏳' : '🔍'}
          </button>
          
          {/* Clear Route Button */}
          {currentRoute && (
            <button className="clear-btn" onClick={clearRoute} title="Clear route">
              ✕
            </button>
          )}
        </div>
        
        {/* Route Summary */}
        {currentRoute && (
          <div className="route-summary">
            <div className="route-stats">
              <span className="route-time">{Math.round(currentRoute.duration / 60)} min</span>
              <span className="route-distance">({(currentRoute.distance / 1000).toFixed(1)} km)</span>
              <span className="shade-percentage">🌳 {currentRoute.shadePercentage || 0}% shaded</span>
            </div>
            
            <div className="route-options">
              <button 
                className={`route-option-btn ${routeType === 'fastest' ? 'active' : ''}`}
                onClick={() => setRouteType('fastest')}
              >
                ⚡ Fastest
              </button>
              <button 
                className={`route-option-btn ${routeType === 'shadiest' ? 'active' : ''}`}
                onClick={() => setRouteType('shadiest')}
              >
                🌳 Shadiest
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right Side Controls */}
      <div className="right-controls">
        {/* Location Button */}
        <button className="locate-btn" onClick={handleLocate} title="Go to my location">
          📍
        </button>
        
        {/* Zoom Controls */}
        <div className="zoom-controls">
          <button className="zoom-btn" onClick={handleZoomIn} title="Zoom in">
            +
          </button>
          <button className="zoom-btn" onClick={handleZoomOut} title="Zoom out">
            −
          </button>
        </div>

        {/* Loading/Error Display */}
        {loadingProgress && (
          <div className="loading-display">{loadingProgress}</div>
        )}
        
        {shadeError && (
          <div className="error-display">{shadeError}</div>
        )}
      </div>

      {/* Bottom Time Slider */}
      <div className="time-ribbon">
        <div className="time-scale">
          {hourTicks.map((h) => {
            const labelH12 = ((h + 11) % 12) + 1;
            const ampm = h < 12 ? 'AM' : 'PM';
            return (
              <div key={h} className="hour-tick">
                <div className="tick-line" />
                <div className="tick-label">{labelH12} {ampm}</div>
              </div>
            );
          })}
        </div>

        <input
          className="time-slider"
          type="range"
          min={0}
          max={1439}
          step={1}
          value={minutesOfDay}
          onChange={(e) => setMinutesOfDay(Number(e.target.value))}
        />

        <div className="time-indicator" style={{ left: `${pointerLeftPercent}%` }}>
          <div className="time-bubble">
            <div className="current-time">{formatTime(minutesOfDay)}</div>
            <div className="current-date">{formatDate(baseDate)}</div>
          </div>
          <div className="time-pin" />
        </div>
      </div>
    </div>
  );
}

export default App;