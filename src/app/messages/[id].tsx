import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Send } from 'lucide-react-native';
import { Banner, Button, ErrorState, LoadingRows, ScreenHeader, Text, TextField } from '@/components/design-system';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { messagesRepository } from '@/repositories';
import { colors, gutter, radii, spacing } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const POLL_MS = 8000;

/**
 * Booking conversation (plan §4.1, Phase 9). In-app only; refreshes every few seconds while open
 * (no push in Expo Go). Keep arrangements here rather than sharing phone numbers.
 */
export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const convo = useAsync(() => messagesRepository.get(id), [id]);
  const { reload } = convo;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const c = convo.data;
  const lastId = c?.messages[c.messages.length - 1]?.id;

  // Mark read on open and whenever new messages arrive; poll while focused.
  useEffect(() => {
    if (lastId) void messagesRepository.markRead(id);
  }, [id, lastId]);
  useFocusEffect(
    useCallback(() => {
      const t = setInterval(() => void reload(), POLL_MS);
      return () => clearInterval(t);
    }, [reload]),
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const r = await messagesRepository.send(id, body);
    setSending(false);
    if (!r.ok) return setError(r.error.message);
    setDraft('');
    await reload();
  };

  const lastMine = c ? [...c.messages].reverse().find((m) => m.senderIsMe) : undefined;
  const seen = Boolean(lastMine && c?.otherLastReadAt && Date.parse(c.otherLastReadAt) >= Date.parse(lastMine.createdAt));

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <ScreenHeader title={c?.counterpart.fullName ?? 'Messages'} subtitle={c ? `${c.listingTitle} · ${formatDateOnly(c.pickupDate)} → ${formatDateOnly(c.returnDate)}` : undefined} size="compact" back />
        {c ? <Button label="View booking" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/booking/[id]', params: { id: c.bookingId } })} testID="conversation-booking" /> : null}
      </View>
      {convo.error ? (
        <View style={styles.pad}><ErrorState offline={convo.error.kind === 'network'} message={convo.error.message} onRetry={reload} /></View>
      ) : !c ? (
        <View style={styles.pad}><LoadingRows rows={3} label="Loading messages" /></View>
      ) : (
        <>
          <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.list} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} testID="message-list">
            {c.messages.length === 0 ? (
              <Text variant="callout" tone="muted" style={styles.center}>No messages yet. Say hi and arrange the pickup time and place.</Text>
            ) : (
              c.messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.senderIsMe ? styles.mine : styles.theirs]} accessibilityLabel={`${m.senderIsMe ? 'You' : c.counterpart.fullName}: ${m.body}`}>
                  <Text variant="body" style={m.senderIsMe ? styles.mineText : undefined}>{m.body}</Text>
                  <Text variant="caption" style={m.senderIsMe ? styles.mineMeta : styles.theirsMeta}>{formatDateTimeManila(m.createdAt)}</Text>
                </View>
              ))
            )}
            {seen ? <Text variant="caption" tone="muted" style={styles.seen}>Seen</Text> : null}
          </ScrollView>
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {c.closedReason ? (
              <Banner tone="neutral" title="Messaging closed" message={c.closedReason} />
            ) : (
              <>
                {error ? <Banner tone="danger" title="Not sent" message={error} /> : null}
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <TextField label="Message" value={draft} onChangeText={setDraft} multiline maxLength={2000} placeholder="Write a message" testID="message-input" />
                  </View>
                  <Button label="Send" icon={Send} onPress={send} loading={sending} disabled={!draft.trim()} disabledReason={undefined} testID="send-message" />
                </View>
                <Text variant="caption" tone="muted">Messages are private to you and {c.counterpart.fullName.split(' ')[0]}; TigRent staff may review them for support.</Text>
              </>
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: gutter },
  pad: { paddingHorizontal: gutter },
  list: { paddingHorizontal: gutter, paddingVertical: spacing.md, gap: spacing.sm },
  bubble: { maxWidth: '82%', borderRadius: radii.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.ink },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  mineText: { color: '#FFFFFF' },
  mineMeta: { color: '#D9D2C2' },
  theirsMeta: { color: colors.textMuted },
  seen: { alignSelf: 'flex-end' },
  composer: { paddingHorizontal: gutter, paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  center: { textAlign: 'center', marginTop: spacing.xl },
  flex: { flex: 1 },
});
