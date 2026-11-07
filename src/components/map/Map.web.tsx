import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { View, StyleSheet } from 'react-native';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapHandle, MapProps } from './types';
import { BAGUIO, DEFAULT_MAP_ZOOM, MAP_LABEL_FONT, MAP_STYLE_URL } from './style';
import { cameraForPlace, cameraForPoints, NO_INSETS, type LngLat } from './camera';
import {
  CLUSTER_LABEL_EXPRESSION,
  CLUSTER_PROPERTIES,
  PIN_CENTER_Y,
  PIN_COLORS,
  PIN_HEIGHT,
  PIN_IMAGE_EXPRESSION,
  PIN_LABEL_OFFSET,
  PIN_LABEL_SIZE,
  PIN_RADIUS,
  PIN_STROKE,
  PIN_WIDTH,
  teardropPoints,
  type PinImageName,
  USER_PUCK,
} from './pins';

const PIN_PIXEL_RATIO = 2;

// Metro's Babel pass injects helpers into maplibre-gl's inlined worker source,
// which then fails inside the worker ("_wrapNativeSuper is not defined") and the
// map never loads. Use the prebuilt CSP worker served from /public instead
// (copied by scripts/copy-maplibre-worker.js).
maplibregl.setWorkerUrl('/maplibre-gl-csp-worker.js');

/** Draws the teardrop pin on a canvas (same geometry as the native PNGs). */
function pinImageData(name: PinImageName): ImageData | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = PIN_WIDTH * PIN_PIXEL_RATIO;
  canvas.height = PIN_HEIGHT * PIN_PIXEL_RATIO;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(PIN_PIXEL_RATIO, PIN_PIXEL_RATIO);
  const cx = PIN_WIDTH / 2;
  const fill = (pts: [number, number][], color: string) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  fill(
    teardropPoints(cx + 0.6, PIN_CENTER_Y + 1, PIN_RADIUS + PIN_STROKE, PIN_HEIGHT - 0.2),
    'rgba(0,0,0,0.24)'
  );
  fill(teardropPoints(cx, PIN_CENTER_Y, PIN_RADIUS + PIN_STROKE, PIN_HEIGHT - 1), '#ffffff');
  fill(
    teardropPoints(cx, PIN_CENTER_Y, PIN_RADIUS, PIN_HEIGHT - 1 - PIN_STROKE * 1.6),
    PIN_COLORS[name]
  );
  if (name === 'pin-place') {
    ctx.beginPath();
    ctx.arc(cx, PIN_CENTER_Y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function ensurePinImages(m: maplibregl.Map) {
  (Object.keys(PIN_COLORS) as PinImageName[]).forEach((name) => {
    if (m.hasImage(name)) return;
    const data = pinImageData(name);
    if (data) m.addImage(name, data, { pixelRatio: PIN_PIXEL_RATIO });
  });
}

export const Map = forwardRef<MapHandle, MapProps>(function Map(
  {
    region,
    initialZoom = DEFAULT_MAP_ZOOM,
    pins = [],
    onPinPress,
    onMapPress,
    style,
    clusterPins = true,
    overlayInsets = NO_INSETS,
    onViewportChange,
    userLocation,
  },
  ref
) {
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const insetsRef = useRef(overlayInsets);
  insetsRef.current = overlayInsets;
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onMapPressRef = useRef(onMapPress);
  const [mapLoaded, setMapLoaded] = useState(false);
  // Set when the pointer or wheel is on the map. Cleared by a move we started.
  const userIntent = useRef(false);
  // Camera at pointer-down. A later programmatic pan must not be compared to it.
  const gestureCamera = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const gestureTimer = useRef<number | null>(null);
  // focus, nudge, and region flyTos. Their moveend is not the user moving the map.
  const programmaticMoves = useRef(0);
  // Increments whenever a gesture is dismissed. Pending checks compare it.
  const programmaticEpoch = useRef(0);

  const dismissGesture = useCallback(() => {
    programmaticEpoch.current += 1;
    userIntent.current = false;
    gestureCamera.current = null;
    if (gestureTimer.current != null) {
      window.clearTimeout(gestureTimer.current);
      gestureTimer.current = null;
    }
  }, []);

  const markProgrammatic = useCallback(() => {
    programmaticMoves.current += 1;
    dismissGesture();
  }, [dismissGesture]);

  onMapPressRef.current = onMapPress;

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const initialCenter: [number, number] = region
      ? [region.longitude, region.latitude]
      : [BAGUIO.longitude, BAGUIO.latitude];

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE_URL,
      center: initialCenter,
      zoom: initialZoom,
    });

    if (typeof window !== 'undefined') {
      (window as any).__WTP_MAP = map.current;
    }

    try {
      map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    } catch (err) {
      console.warn('NavigationControl failed', err);
    }

    map.current.on('load', () => {
      setMapLoaded(true);
    });
    map.current.on('click', (e) => {
      onMapPressRef.current?.({
        latitude: e.lngLat.lat,
        longitude: e.lngLat.lng,
      });
    });
    const emitViewport = (isUserInteraction: boolean) => {
      const m = map.current;
      if (!m || !onViewportChangeRef.current) return;
      const b = m.getBounds();
      const c = m.getCenter();
      onViewportChangeRef.current({
        center: { latitude: c.lat, longitude: c.lng },
        zoom: m.getZoom(),
        bounds: {
          ne: { latitude: b.getNorth(), longitude: b.getEast() },
          sw: { latitude: b.getSouth(), longitude: b.getWest() },
        },
        isUserInteraction,
      });
    };
    // MapLibre often omits originalEvent on moveend (inertia). A pointer or
    // wheel on the map is the user. focus, nudge, and settle clear that.
    const canvas = map.current.getCanvasContainer();
    const snapshot = () => {
      const current = map.current;
      if (!current) return null;
      const center = current.getCenter();
      return { lat: center.lat, lng: center.lng, zoom: current.getZoom() };
    };
    const cameraChanged = (
      from: { lat: number; lng: number; zoom: number } | null,
      to: { lat: number; lng: number; zoom: number } | null
    ) =>
      !!from &&
      !!to &&
      (Math.abs(from.lat - to.lat) > 1e-7 ||
        Math.abs(from.lng - to.lng) > 1e-7 ||
        Math.abs(from.zoom - to.zoom) > 0.01);
    const arm = () => {
      userIntent.current = true;
      if (!gestureCamera.current) gestureCamera.current = snapshot();
    };
    canvas.addEventListener('pointerdown', arm, true);
    canvas.addEventListener(
      'pointermove',
      (event: PointerEvent) => {
        if (event.buttons) arm();
      },
      true
    );
    canvas.addEventListener('wheel', arm, { passive: true, capture: true });
    const endGesture = () => {
      const origin = gestureCamera.current;
      const epoch = programmaticEpoch.current;
      if (gestureTimer.current != null) window.clearTimeout(gestureTimer.current);
      gestureTimer.current = window.setTimeout(() => {
        gestureTimer.current = null;
        // A focus, sheet pan, or parking search since the finger went up owns
        // that camera change.
        if (programmaticEpoch.current !== epoch) {
          gestureCamera.current = null;
          return;
        }
        if (cameraChanged(origin, snapshot())) emitViewport(true);
        gestureCamera.current = null;
      }, 450);
    };
    canvas.addEventListener('pointerup', endGesture, true);
    canvas.addEventListener('pointercancel', endGesture, true);
    // Report the first viewport too, so callers know the visible area at start.
    map.current.on('load', () => emitViewport(false));
    map.current.on('moveend', (e: any) => {
      if (programmaticMoves.current > 0) {
        programmaticMoves.current -= 1;
        userIntent.current = false;
        emitViewport(false);
        return;
      }
      // Camera drift from a sheet pan is not a user move. Only a pointer,
      // wheel, or control click (originalEvent) is.
      const user = userIntent.current || !!e?.originalEvent;
      userIntent.current = false;
      emitViewport(user);
    });
    const fallback = setTimeout(() => setMapLoaded(true), 2500);

    map.current.on('idle', () => {
      if (typeof window !== 'undefined') {
        (window as any).__WTP_MAP_IDLE = true;
      }
      if (mapContainer.current) {
        mapContainer.current.setAttribute('data-map-idle', 'true');
      }
    });

    return () => {
      clearTimeout(fallback);
      if (gestureTimer.current != null) window.clearTimeout(gestureTimer.current);
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
    // Map instance is created once; region updates fly in a later effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update pins
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const pinFeatures = pins.map((pin) => ({
      type: 'Feature' as const,
      id: pin.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [pin.coordinate.longitude, pin.coordinate.latitude],
      },
      properties: {
        id: pin.id,
        availableCount: pin.availableCount,
        availableSlots: pin.availableSlots ?? Math.max(0, pin.availableCount || 0),
        // '' = a plain pin with no number (rj t140u).
        pinLabel: pin.pinLabel ?? String(pin.availableCount),
        isStale: pin.isStale ? 1 : 0,
        isFull: pin.isFull ? 1 : 0,
        title: pin.title,
      },
    }));

    const geoJSON: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pinFeatures,
    };

    const sourceId = 'location-pins';
    const source = map.current.getSource(sourceId);

    if (typeof window !== 'undefined') {
      (window as any).__WTP_MAP_IDLE = false;
      (window as any).__WTP_PIN_COUNT = pins.length;
    }
    if (mapContainer.current) {
      mapContainer.current.setAttribute('data-map-idle', 'false');
      mapContainer.current.setAttribute('data-pin-count', String(pins.length));
    }

    try {
      if (source) {
        (source as maplibregl.GeoJSONSource).setData(geoJSON);
      } else {
        map.current.addSource(sourceId, {
          type: 'geojson',
          data: geoJSON,
          cluster: clusterPins,
          clusterProperties: CLUSTER_PROPERTIES as any,
          clusterMaxZoom: 16,
          clusterRadius: 80,
        });

        // Cluster circles
        map.current.addLayer({
          id: 'cluster-circle',
          type: 'circle',
          source: sourceId,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#2563eb',
            'circle-radius': 20,
            'circle-opacity': 0.9,
          },
        });

        // Cluster count
        map.current.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: sourceId,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': CLUSTER_LABEL_EXPRESSION as any,
            'text-font': MAP_LABEL_FONT,
            'text-size': 12,
          },
          paint: {
            'text-color': '#ffffff',
          },
        });

        // Individual pins: teardrop with the tip on the exact coordinate.
        ensurePinImages(map.current);
        map.current.addLayer({
          id: 'pin-marker',
          type: 'symbol',
          source: sourceId,
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': PIN_IMAGE_EXPRESSION as any,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['get', 'pinLabel'],
            'text-font': MAP_LABEL_FONT,
            'text-size': PIN_LABEL_SIZE,
            'text-offset': PIN_LABEL_OFFSET,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#ffffff',
          },
        });

        // Click handler
        map.current.on('click', 'pin-marker', (e) => {
          if (e.features && e.features[0] && onPinPress) {
            const feature = e.features[0];
            const locationId = feature.properties?.id;
            if (locationId) {
              onPinPress(locationId);
            }
          }
        });

        // Change cursor on hover
        map.current.on('mouseenter', 'pin-marker', () => {
          if (map.current) {
            map.current.getCanvas().style.cursor = 'pointer';
          }
        });

        map.current.on('mouseleave', 'pin-marker', () => {
          if (map.current) {
            map.current.getCanvas().style.cursor = '';
          }
        });

        map.current.on('click', 'cluster-circle', (e) => {
          const feature = e.features && e.features[0];
          const clusterId = feature?.properties?.cluster_id;
          const coords = (feature?.geometry as GeoJSON.Point | undefined)?.coordinates;
          const src = map.current?.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
          if (clusterId == null || !src || !coords) return;
          const count = Number(feature?.properties?.point_count) || 100;
          // Zoom until every leaf of the cluster is visible above the overlays.
          Promise.all([
            src.getClusterLeaves(clusterId, count, 0),
            src.getClusterExpansionZoom(clusterId).catch(() => DEFAULT_MAP_ZOOM + 2),
          ])
            .then(([leaves, expansionZoom]) => {
              const m = map.current;
              if (!m) return;
              const points = leaves
                .map((f) => (f.geometry as GeoJSON.Point | undefined)?.coordinates as LngLat)
                .filter((c) => Array.isArray(c));
              const container = m.getContainer();
              const camera = cameraForPoints(
                points,
                { width: container.clientWidth, height: container.clientHeight },
                { insets: insetsRef.current, fallbackZoom: Math.max(expansionZoom, 16) }
              );
              if (camera) m.easeTo({ center: camera.center, zoom: camera.zoom, duration: 600 });
            })
            .catch((err) => console.warn('Cluster expansion failed', err));
        });
      }
    } catch (err) {
      console.warn('GeoJSON pin layers failed', err);
    }

    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (mapContainer.current) {
      mapContainer.current.setAttribute('data-cluster', clusterPins ? 'true' : 'false');
    }
  }, [pins, mapLoaded, clusterPins, onPinPress]);

  useImperativeHandle(ref, () => ({
    focus: (target) => {
      const m = map.current;
      if (!m) return;
      const container = m.getContainer();
      const camera = cameraForPlace(
        target,
        { width: container.clientWidth, height: container.clientHeight },
        insetsRef.current
      );
      if (camera) {
        markProgrammatic();
        m.flyTo({ center: camera.center, zoom: camera.zoom, duration: 1200 });
      }
    },
    nudge: (dyPx: number) => {
      if (!dyPx) return;
      markProgrammatic();
      // Positive y moves the camera to the point currently below the centre (south).
      map.current?.panBy([0, dyPx], { duration: 0 });
    },
    settle: () => {
      const m = map.current;
      dismissGesture();
      // Leftover inertia would otherwise end after the parking search and look
      // like a new pan. Stopping it fires moveend, which the counter swallows.
      if (m?.isEasing()) {
        programmaticMoves.current += 1;
        m.stop();
      }
    },
    readViewport: () => {
      const m = map.current;
      if (!m) return null;
      try {
        const bounds = m.getBounds();
        const center = m.getCenter();
        return {
          center: { latitude: center.lat, longitude: center.lng },
          zoom: m.getZoom(),
          bounds: {
            ne: { latitude: bounds.getNorth(), longitude: bounds.getEast() },
            sw: { latitude: bounds.getSouth(), longitude: bounds.getWest() },
          },
          isUserInteraction: false,
        };
      } catch {
        return null;
      }
    },
  }));

  // Current-location puck: a DOM marker so it needs no style images.
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!map.current || !userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    const lngLat: [number, number] = [
      userLocation.coordinate.longitude,
      userLocation.coordinate.latitude,
    ];
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat(lngLat);
      return;
    }
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'user-location-puck');
    el.style.cssText = `width:36px;height:36px;border-radius:18px;background:${USER_PUCK.halo}2e;display:flex;align-items:center;justify-content:center;pointer-events:none`;
    const dot = document.createElement('div');
    dot.style.cssText = `width:14px;height:14px;border-radius:10px;background:${USER_PUCK.dot};border:3px solid ${USER_PUCK.ring};box-shadow:0 1px 3px rgba(0,0,0,.3)`;
    el.appendChild(dot);
    userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(lngLat)
      .addTo(map.current);
  }, [userLocation, mapLoaded]);

  // Keep the zoom/compass buttons below overlays such as the place search box.
  useEffect(() => {
    const ctrl = mapContainer.current?.querySelector<HTMLElement>('.maplibregl-ctrl-top-right');
    if (ctrl) ctrl.style.top = `${overlayInsets.top}px`;
  }, [overlayInsets.top, mapLoaded]);

  // Update region
  useEffect(() => {
    if (!map.current || !region) return;

    markProgrammatic();
    map.current.flyTo({
      center: [region.longitude, region.latitude],
      zoom: initialZoom,
      duration: 1000,
    });
  }, [region, initialZoom, markProgrammatic]);

  return (
    <View style={[styles.container, style]}>
      <div ref={mapContainer} style={styles.map as any} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
});
