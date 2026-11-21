import { Redirect, useLocalSearchParams } from 'expo-router';
import { forwardSearchParams, type SearchLinkQuery } from '../src/lib/searchLink';

export default function Index() {
  const params = useLocalSearchParams<SearchLinkQuery>();
  const forwarded = forwardSearchParams(params);
  if (!forwarded) return <Redirect href="/search" />;
  return <Redirect href={{ pathname: '/search', params: forwarded }} />;
}
