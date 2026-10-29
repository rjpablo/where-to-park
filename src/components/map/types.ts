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

export interface MapProps {
  region?: MapRegion;
  pins?: LocationPin[];
  onPinPress?: (locationId: string) => void;
  onMapPress?: (coordinate: Coordinate) => void;
  onRegionChange?: (region: MapRegion) => void;
  style?: ViewStyle;
  showsUserLocation?: boolean;
  clusterPins?: boolean;
}

export interface MapPinPickerProps {
  initialCoordinate?: Coordinate;
  onCoordinateSelect: (coordinate: Coordinate) => void;
  style?: ViewStyle;
}
