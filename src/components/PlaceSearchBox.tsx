import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getGeocoder, type PlaceSuggestion } from '../lib/geocoding';
import type { Coordinate } from './map/types';
import { theme } from '../lib/theme';

type Props = {
  /** Bias suggestions towards this point (the current map centre). */
  near?: Coordinate;
  onSelect: (place: PlaceSuggestion) => void;
  onClear?: () => void;
  /** Called when the suggestions list opens or closes (the search screen lifts the box
   *  above the results sheet while it is open). */
  onSuggestionsVisibleChange?: (visible: boolean) => void;
};

/** Map place search with debounced as-you-type suggestions. */
export function PlaceSearchBox({ near, onSelect, onClear, onSuggestionsVisibleChange }: Props) {
  const geocoder = getGeocoder();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const nearRef = useRef(near);
  nearRef.current = near;
  // The text shown after picking a place should not trigger another lookup.
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < geocoder.minQueryLength) {
      setSuggestions([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const results = await geocoder.suggest(q, {
          near: nearRef.current,
          signal: controller.signal,
        });
        setSuggestions(results);
        setOpen(true);
      } catch (err: any) {
        if (err?.name !== 'AbortError') setError('Could not search places');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, geocoder.debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, geocoder]);

  const pick = (place: PlaceSuggestion) => {
    skipNext.current = true;
    setQuery(place.name);
    setSuggestions([]);
    setOpen(false);
    Keyboard.dismiss();
    onSelect(place);
  };

  const clear = () => {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setError(null);
    onClear?.();
  };

  const showList = open && query.trim().length >= geocoder.minQueryLength;
  const listVisible = showList && (suggestions.length > 0 || !!error || !loading);
  useEffect(() => {
    onSuggestionsVisibleChange?.(listVisible);
  }, [listVisible, onSuggestionsVisibleChange]);

  return (
    <View style={styles.wrap} testID="place-search">
      <View style={styles.box}>
        <Text style={styles.icon}>⌕</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search a place or address"
          placeholderTextColor={theme.colors.text.tertiary}
          returnKeyType="search"
          onSubmitEditing={() => suggestions[0] && pick(suggestions[0])}
          autoCorrect={false}
          testID="place-search-input"
        />
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
        {query ? (
          <TouchableOpacity
            onPress={clear}
            accessibilityLabel="Clear place search"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="place-search-clear"
          >
            <Text style={styles.clear}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {listVisible ? (
        <View style={styles.list} testID="place-suggestions">
          {error ? <Text style={styles.empty}>{error}</Text> : null}
          {!error && !loading && suggestions.length === 0 ? (
            <Text style={styles.empty}>No places found</Text>
          ) : null}
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.item, i > 0 && styles.itemBorder]}
              onPress={() => pick(s)}
              testID={`place-suggestion-${i}`}
            >
              <Text style={styles.itemName} numberOfLines={1}>
                {s.name}
              </Text>
              {s.detail ? (
                <Text style={styles.itemDetail} numberOfLines={1}>
                  {s.detail}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
          <Text style={styles.attribution}>{geocoder.attribution}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.full,
    minHeight: 46,
    ...theme.shadows.md,
  },
  icon: { fontSize: 18, color: theme.colors.text.secondary },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.text.primary,
  },
  clear: { fontSize: 16, color: theme.colors.text.secondary, paddingHorizontal: 4 },
  list: {
    marginTop: theme.spacing.xs,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    ...theme.shadows.md,
  },
  item: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  itemName: { ...theme.typography.body, fontWeight: '600' },
  itemDetail: { ...theme.typography.caption, color: theme.colors.text.secondary },
  empty: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    padding: theme.spacing.md,
  },
  attribution: {
    ...theme.typography.caption,
    fontSize: 10,
    color: theme.colors.text.tertiary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    textAlign: 'right',
  },
});
