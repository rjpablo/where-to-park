import { ViewStyle } from 'react-native';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface LocationPin {
  id: string;
  coordinate: Coordinate;
  availableCount: number;
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

export interface MapProps {
  region?: MapRegion;
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
}

export interface MapPinPickerProps {
  initialCoordinate?: Coordinate;
  onCoordinateSelect: (coordinate: Coordinate) => void;
  style?: ViewStyle;
}
