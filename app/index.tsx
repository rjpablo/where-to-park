import { Redirect, useLocalSearchParams } from 'expo-router';
import { forwardSearchParams } from '../src/lib/searchLink';

export default function Index() {
  const params = useLocalSearchParams<{
    lat?: string | string[];
    lng?: string | string[];
    place?: string | string[];
  }>();
  const forwarded = forwardSearchParams(params);
  if (!forwarded) return <Redirect href="/search" />;
  return <Redirect href={{ pathname: '/search', params: forwarded }} />;
}
