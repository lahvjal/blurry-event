import { useLocalSearchParams } from 'expo-router';

import DirectMessage from './direct-message';
import GroupConversation from './group-conversation';

export default function AccountConversation() {
  const params = useLocalSearchParams<{ kind?: string }>();
  return params.kind === 'direct' ? <DirectMessage /> : <GroupConversation />;
}
