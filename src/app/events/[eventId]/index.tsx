import { Redirect, useLocalSearchParams } from 'expo-router';

import { eventPath } from '@/lib/routes';

export default function EventIndexRedirect() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  if (!params.eventId) return <Redirect href="/events" />;
  return <Redirect href={eventPath(params.eventId, 'event') as never} />;
}
