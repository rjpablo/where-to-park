import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Button } from '../Button';
import { theme } from '../../lib/theme';
import { Map } from './Map';
import { MapPinPickerProps, Coordinate, MapRegion } from './types';

const BAGUIO: Coordinate = { latitude: 16.412, longitude: 120.596 };

export const MapPinPicker: React.FC<MapPinPickerProps> = ({
  initialCoordinate,
  onCoordinateSelect,
  style,
}) => {
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate>(
    initialCoordinate || BAGUIO
  );
  const [region, setRegion] = useState<MapRegion>({
    latitude: initialCoordinate?.latitude || BAGUIO.latitude,
    longitude: initialCoordinate?.longitude || BAGUIO.longitude,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });

  const handleMapPress = useCallback(
    (coordinate: Coordinate) => {
      setSelectedCoordinate(coordinate);
      onCoordinateSelect(coordinate);
    },
    [onCoordinateSelect]
  );

  const handleConfirm = useCallback(() => {
    onCoordinateSelect(selectedCoordinate);
  }, [selectedCoordinate, onCoordinateSelect]);

  return (
    <View style={[styles.container, style]} testID="map-pin-picker">
      <Map
        region={region}
        onRegionChange={setRegion}
        onMapPress={handleMapPress}
        pins={[
          {
            id: 'selected',
            coordinate: selectedCoordinate,
            availableCount: 1,
            isStale: false,
            title: 'Selected pin',
          },
        ]}
        showsUserLocation={false}
        clusterPins={false}
        style={styles.map}
      />

      <View style={styles.footer}>
        <Text style={styles.hint}>Tap the map to drop the pin</Text>
        <Text style={styles.coords} testID="pin-coordinates">
          {selectedCoordinate.latitude.toFixed(6)}, {selectedCoordinate.longitude.toFixed(6)}
        </Text>
        <Button title="Use this pin" onPress={handleConfirm} testID="pin-confirm" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 360,
  },
  map: {
    height: 280,
    width: '100%',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  footer: {
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  hint: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  coords: {
    ...theme.typography.body,
    fontWeight: '600',
    textAlign: 'center',
  },
});
