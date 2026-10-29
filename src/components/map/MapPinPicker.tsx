import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Map } from './Map';
import { MapPinPickerProps, Coordinate, MapRegion } from './types';

export const MapPinPicker: React.FC<MapPinPickerProps> = ({
  initialCoordinate,
  onCoordinateSelect,
  style,
}) => {
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate | undefined>(
    initialCoordinate
  );
  const [region, setRegion] = useState<MapRegion>({
    latitude: initialCoordinate?.latitude || 16.4120,
    longitude: initialCoordinate?.longitude || 120.5960,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });

  const handleMapPress = useCallback((coordinate: Coordinate) => {
    setSelectedCoordinate(coordinate);
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedCoordinate) {
      onCoordinateSelect(selectedCoordinate);
    }
  }, [selectedCoordinate, onCoordinateSelect]);

  return (
    <View style={[styles.container, style]}>
      <Map
        region={region}
        onRegionChange={setRegion}
        pins={
          selectedCoordinate
            ? [
                {
                  id: 'selected',
                  coordinate: selectedCoordinate,
                  availableCount: 0,
                  isStale: false,
                  title: 'Selected Location',
                },
              ]
            : []
        }
        showsUserLocation
        clusterPins={false}
        style={styles.map}
      />

      <View style={styles.footer}>
        {selectedCoordinate && (
          <View style={styles.coordInfo}>
            <Text className="text-sm text-gray-600">
              {selectedCoordinate.latitude.toFixed(6)}, {selectedCoordinate.longitude.toFixed(6)}
            </Text>
          </View>
        )}
        <Button
          onPress={handleConfirm}
          disabled={!selectedCoordinate}
          className="w-full"
        >
          <Text>Confirm Location</Text>
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  footer: {
    padding: 16,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  coordInfo: {
    marginBottom: 12,
    alignItems: 'center',
  },
});
