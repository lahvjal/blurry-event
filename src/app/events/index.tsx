import { Redirect } from 'expo-router';

/** Compatibility only: Home owns event focus and its selector owns switching. */
export default function EventsCompatibilityRedirect() {
  return <Redirect href="/event" />;
}
