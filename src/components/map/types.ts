import { ViewStyle } from 'react-native';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface LocationPin {
  id: string;
  coordinate: Coordinate;
  availableCount: number;
  /** Free slots summed into cluster pins (defaults to availableCount; 0 for Open/Full). */
  availableSlots?: number;
  pinLabel?: string;
  isStale: boolean;
  isFull?: boolean;
  title: string;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** What the map currently shows; reported after every camera move. */
export interface MapViewport {
  center: Coordinate;
  zoom: number;
  bounds: { ne: Coordinate; sw: Coordinate };
  /** True when the move came from the user's own pan/zoom gesture. */
  isUserInteraction: boolean;
}

export interface MapFocusTarget {
  coordinate: Coordinate;
  bounds?: { ne: Coordinate; sw: Coordinate };
  zoom?: number;
}

/** Imperative map controls (via ref). */
export interface MapHandle {
  /** Move the camera to a place, framing its bounds when known. */
  focus: (target: MapFocusTarget) => void;
  /**
   * Pan by `dyPx` pixels down the screen (positive is south) without changing
   * zoom. Not a user gesture.
   */
  nudge: (dyPx: number) => void;
  /** Camera, zoom, and bounds right now. */
  readViewport: () => MapViewport | null;
  /**
   * The current gesture is over. An in-flight pan or its leftover inertia must
   * not count as the user moving the map again.
   */
  settle: () => void;
}

export interface MapProps {
  region?: MapRegion;
  /** Zoom used for `region` (defaults to DEFAULT_MAP_ZOOM). */
  initialZoom?: number;
  pins?: LocationPin[];
  onPinPress?: (locationId: string) => void;
  onMapPress?: (coordinate: Coordinate) => void;
  onRegionChange?: (region: MapRegion) => void;
  onViewportChange?: (viewport: MapViewport) => void;
  style?: ViewStyle;
  showsUserLocation?: boolean;
  clusterPins?: boolean;
  /** Px of the map covered by overlays (search box, bottom sheet) to keep pins out of. */
  overlayInsets?: { top: number; right: number; bottom: number; left: number };
  /** The user's current location, drawn as a blue puck (null/undefined hides it). */
  userLocation?: { coordinate: Coordinate; accuracyM?: number } | null;
}

export interface MapPinPickerProps {
  initialCoordinate?: Coordinate;
  onCoordinateSelect: (coordinate: Coordinate) => void;
  /** The listing's saved pin (edit listing only): shows 'Restore saved pin' after a move. */
  savedCoordinate?: Coordinate | null;
  /** True while a finger is on the map, false when the touch ends: the screen's ScrollView
   *  turns scrolling off meanwhile so drags and pinches pan / zoom the map, not the page. */
  onMapGestureChange?: (active: boolean) => void;
  style?: ViewStyle;
}
