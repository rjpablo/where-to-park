import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { carouselCounter, clampIndex, indexFromOffset } from '../lib/carousel';

export type CarouselImage = {
  key: string;
  uri: string;
  /** Optional small caption, e.g. 'From a review'. */
  label?: string | null;
};

type Props = {
  images: CarouselImage[];
  /** Index to open at; the carousel is shown while this is not null. */
  startIndex: number | null;
  onClose: () => void;
  testID?: string;
};

/**
 * Floating full-screen photo viewer: swipe between photos (‹ › buttons too, for the
 * web), ✕ to close, and an index like '2/5'. Used for listing photos, the Photos tab
 * and review photos.
 */
export function ImageCarousel({ images, startIndex, onClose, testID = 'image-carousel' }: Props) {
  const { width, height } = useWindowDimensions();
  const visible = startIndex != null && images.length > 0;
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<CarouselImage>>(null);

  useEffect(() => {
    if (visible) setIndex(clampIndex(startIndex ?? 0, images.length));
  }, [visible, startIndex, images.length]);

  const goTo = useCallback(
    (next: number) => {
      const i = clampIndex(next, images.length);
      setIndex(i);
      listRef.current?.scrollToOffset({ offset: i * width, animated: true });
    },
    [images.length, width]
  );

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(indexFromOffset(e.nativeEvent.contentOffset.x, width, images.length));
  };

  if (!visible) return null;
  const current = images[clampIndex(index, images.length)];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} testID={testID}>
        <FlatList
          ref={listRef}
          data={images}
          keyExtractor={(item) => item.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={clampIndex(startIndex ?? 0, images.length)}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={onScrollEnd}
          // The web has no momentum events for mouse/trackpad scrolling.
          onScroll={Platform.OS === 'web' ? onScrollEnd : undefined}
          scrollEventThrottle={64}
          renderItem={({ item, index: i }) => (
            <View style={[styles.page, { width, height }]}>
              <Image
                source={{ uri: item.uri }}
                style={{ width, height: height * 0.8 }}
                resizeMode="contain"
                testID={`${testID}-image-${i}`}
              />
            </View>
          )}
        />
        <View style={styles.topBar} pointerEvents="box-none">
          <Text style={styles.counter} testID={`${testID}-counter`}>
            {carouselCounter(index, images.length)}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Close photos"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID={`${testID}-close`}
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        {current?.label ? (
          <Text style={styles.label} testID={`${testID}-label`}>
            {current.label}
          </Text>
        ) : null}
        {images.length > 1 && index > 0 ? (
          <TouchableOpacity
            style={[styles.arrow, { left: 8, top: height / 2 - 22 }]}
            onPress={() => goTo(index - 1)}
            accessibilityLabel="Previous photo"
            testID={`${testID}-prev`}
          >
            <Text style={styles.arrowText}>‹</Text>
          </TouchableOpacity>
        ) : null}
        {images.length > 1 && index < images.length - 1 ? (
          <TouchableOpacity
            style={[styles.arrow, { right: 8, top: height / 2 - 22 }]}
            onPress={() => goTo(index + 1)}
            accessibilityLabel="Next photo"
            testID={`${testID}-next`}
          >
            <Text style={styles.arrowText}>›</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  page: { justifyContent: 'center', alignItems: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counter: { color: '#fff', fontSize: 16, fontWeight: '600' },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  label: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 13,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  arrow: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 30, lineHeight: 34 },
});
