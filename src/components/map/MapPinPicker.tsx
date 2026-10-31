import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { theme } from '../../lib/theme';
import { showRestorePin } from '../../lib/pinRestore';
import { Map } from './Map';
import { BAGUIO } from './style';
import { MapPinPickerProps, Coordinate, MapRegion } from './types';

// Tapping the map moves the pin and reports it (the form saves it); no confirm
// button and no coordinates text. With savedCoordinate (edit listing), a small
// 'Restore saved pin' button shows while the pin is away from the saved spot.
export const MapPinPicker: React.FC<MapPinPickerProps> = ({
  initialCoordinate,
  onCoordinateSelect,
  savedCoordinate,
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

  // Put the pin back on the saved spot and recentre the map there.
  const handleRestore = useCallback(() => {
    if (!savedCoordinate) return;
    setSelectedCoordinate(savedCoordinate);
    setRegion((r) => ({
      ...r,
      latitude: savedCoordinate.latitude,
      longitude: savedCoordinate.longitude,
    }));
    onCoordinateSelect(savedCoordinate);
  }, [savedCoordinate, onCoordinateSelect]);

  return (
    <View style={[styles.container, style]} testID="map-pin-picker">
      <View>
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
        {showRestorePin(selectedCoordinate, savedCoordinate) ? (
          <TouchableOpacity
            onPress={handleRestore}
            style={styles.restore}
            accessibilityRole="button"
            accessibilityLabel="Restore saved pin"
            testID="pin-restore"
          >
            <Text style={styles.restoreIcon}>↺</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.hint}>Tap the map to drop the pin</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 300,
  },
  map: {
    height: 280,
    width: '100%',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  restore: {
    position: 'absolute',
    top: theme.spacing.sm,
    left: theme.spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  restoreIcon: {
    fontSize: 22,
    lineHeight: 26,
    color: theme.colors.primary,
    fontWeight: '700',
  },
  hint: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    paddingTop: theme.spacing.sm,
  },
});
