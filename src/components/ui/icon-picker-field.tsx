import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/action-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { IconButton } from '@/components/ui/icon-button';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import {
  ICON_CATALOG,
  ICON_TOPICS,
  SUGGESTED_GLYPHS,
  findCatalogIcon,
  legacyIconLabel,
  searchCatalog,
  type CatalogIcon,
  type IconTopic,
} from '@/theme/icon-catalog';
import { radius, space } from '@/theme/tokens';
import { fontStyle } from '@/theme/typography';
import { hapticSelection } from '@/utils/haptics';
import { emojiIconId, normalizeEmoji, parseIconId } from '@/utils/icon-id';

type Tab = 'suggested' | 'all' | IconTopic | 'custom';

const CELL = 64;
const GAP = 8;
const MODAL_MAX_WIDTH = 560;
const MODAL_PADDING = 18;
const QUICK_EMOJI = ['🍕', '🍔', '☕', '🛒', '🏠', '🚗', '✈️', '🎁', '🎮', '🎬', '🐶', '🐱', '💊', '💇', '🏋️', '📚', '💼', '💰', '🎓', '👶', '🌱', '🔧', '📱', '🎉'];

function iconLabel(id: string) {
  const parsed = parseIconId(id);
  if (parsed.kind === 'emoji') return 'Emoji';
  if (parsed.kind === 'ion') return findCatalogIcon(id)?.label ?? 'Icon';
  return legacyIconLabel(id) ?? 'Icon';
}

/**
 * A "Choose icon" row that opens a searchable, topic-filtered browser of the whole icon set,
 * plus a way to use any emoji as the icon.
 */
export function IconPickerField({
  label,
  value,
  onChange,
  kind,
  previewColor,
  previewBackground,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  /** Decides which icons are suggested first. */
  kind: 'expense' | 'income';
  previewColor: string;
  previewBackground: string;
}) {
  const theme = useQashyTheme();
  const { isRtl, t } = useLocalization();
  const { height, width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('suggested');
  const [emojiDraft, setEmojiDraft] = useState('');

  const currentLabel = iconLabel(value);
  const modalWidth = Math.min(MODAL_MAX_WIDTH, width - 36);
  const columns = Math.max(3, Math.floor((modalWidth - MODAL_PADDING * 2 + GAP) / (CELL + GAP)));

  const suggested = useMemo(
    () => SUGGESTED_GLYPHS[kind]
      .map((glyph) => ICON_CATALOG.find((icon) => icon.glyph === glyph))
      .filter((icon): icon is CatalogIcon => Boolean(icon)),
    [kind],
  );

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (searching) return searchCatalog(query, 'all');
    if (tab === 'suggested') return suggested;
    if (tab === 'custom') return [];
    return searchCatalog('', tab);
  }, [query, searching, suggested, tab]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setEmojiDraft('');
    setTab('suggested');
  };

  const choose = (id: string) => {
    hapticSelection();
    onChange(id);
    close();
  };

  const emoji = normalizeEmoji(emojiDraft);
  const showCustom = tab === 'custom' && !searching;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'suggested', label: 'Suggested' },
    { id: 'all', label: 'All' },
    ...ICON_TOPICS.map((topic) => ({ id: topic.id as Tab, label: topic.label })),
    { id: 'custom', label: 'Emoji' },
  ];

  return (
    <View style={{ gap: 7 }}>
      <AppText variant="label">{label}</AppText>
      <MotionPressable
        accessibilityLabel={t(label)}
        accessibilityHint={t('Opens the icon browser')}
        accessibilityRole="button"
        accessibilityValue={{ text: t(currentLabel) }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            minHeight: 64,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radius.tile,
            borderCurve: 'continuous',
            opacity: pressed ? 0.8 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          },
          materialStyle(theme, 'control'),
        ]}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.control,
            borderCurve: 'continuous',
            backgroundColor: previewBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AppIcon name={value} color={previewColor} size={24} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <AppText>{currentLabel}</AppText>
          <AppText variant="caption" muted>Choose icon</AppText>
        </View>
        <AppIcon name="chevron.right" color={theme.textMuted} size={18} />
      </MotionPressable>

      <Modal animationType="fade" transparent visible={open} onRequestClose={close}>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={{ flex: 1, justifyContent: 'center', padding: 18 }}>
          <Pressable
            accessibilityLabel={t('Close icon browser')}
            accessibilityRole="button"
            onPress={close}
            style={{ position: 'absolute', inset: 0, backgroundColor: theme.scrim }}
          />
          <MotionView
            accessibilityViewIsModal
            importantForAccessibility="yes"
            variant="zoom"
            style={[
              {
                width: '100%',
                maxWidth: MODAL_MAX_WIDTH,
                height: Math.min(640, height - 72),
                alignSelf: 'center',
                padding: MODAL_PADDING,
                gap: 12,
                borderRadius: radius.card,
                borderCurve: 'continuous',
              },
              materialStyle(theme, 'raised'),
              { boxShadow: theme.shadowOverlay },
            ]}>
            <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="headline">Choose icon</AppText>
                <AppText variant="caption" muted>{`${ICON_CATALOG.length} icons, or use any emoji`}</AppText>
              </View>
              <IconButton label="Close icon browser" icon="xmark" onPress={close} />
            </View>

            <View style={{ position: 'relative', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', start: 14, zIndex: 1 }}>
                <AppIcon name="magnifyingglass" color={theme.textMuted} size={18} />
              </View>
              <TextInput
                accessibilityLabel={t('Search icons')}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('Search icons, e.g. coffee or rent')}
                placeholderTextColor={theme.textMuted}
                value={query}
                onChangeText={setQuery}
                style={{
                  minHeight: 48,
                  paddingStart: 42,
                  paddingEnd: 14,
                  borderRadius: radius.tile,
                  borderCurve: 'continuous',
                  backgroundColor: theme.surfaceMuted,
                  color: theme.text,
                  fontSize: 16,
                  ...fontStyle('regular'),
                  writingDirection: isRtl ? 'rtl' : 'ltr',
                  textAlign: isRtl ? 'right' : 'left',
                }}
              />
            </View>

            {!searching ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="tablist"
                contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingHorizontal: 2 }}
                style={{ flexGrow: 0 }}>
                {tabs.map((item) => (
                  <ChoiceChip key={item.id} mode="button" label={item.label} selected={tab === item.id} onPress={() => setTab(item.id)} />
                ))}
              </ScrollView>
            ) : null}

            {showCustom ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
                <View style={{ gap: 6 }}>
                  <AppText variant="label">Use an emoji</AppText>
                  <AppText variant="caption" muted>Type or paste one emoji, or pick below. Emoji keep their own colors.</AppText>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <TextInput
                    accessibilityLabel={t('Emoji')}
                    autoCorrect={false}
                    maxLength={16}
                    value={emojiDraft}
                    onChangeText={setEmojiDraft}
                    placeholder="🙂"
                    placeholderTextColor={theme.textMuted}
                    style={{
                      width: 72,
                      minHeight: 56,
                      textAlign: 'center',
                      fontSize: 28,
                      borderRadius: radius.tile,
                      borderCurve: 'continuous',
                      backgroundColor: theme.surfaceMuted,
                      color: theme.text,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      title="Use emoji"
                      icon="checkmark"
                      disabled={!emoji}
                      onPress={() => emoji && choose(emojiIconId(emoji))}
                    />
                  </View>
                </View>
                {emojiDraft.trim() && !emoji ? <AppText variant="caption" style={{ color: theme.negative }}>Enter exactly one emoji.</AppText> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                  {QUICK_EMOJI.map((item) => {
                    const id = emojiIconId(item);
                    const selected = value === id;
                    return (
                      <MotionPressable
                        key={item}
                        accessibilityRole="radio"
                        accessibilityLabel={item}
                        accessibilityState={{ selected }}
                        active={selected}
                        onPress={() => choose(id)}
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: radius.control,
                          borderCurve: 'continuous',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? theme.accentContainer : theme.surfaceMuted,
                        }}>
                        <AppIcon name={id} color={theme.text} size={26} />
                      </MotionPressable>
                    );
                  })}
                </View>
              </ScrollView>
            ) : (
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('Choose icon')}
                accessibilityLiveRegion="polite"
                aria-live="polite"
                style={{ flex: 1 }}>
                <FlatList
                  // numColumns cannot change on a mounted list.
                  key={columns}
                  data={results}
                  numColumns={columns}
                  keyExtractor={(icon) => icon.id}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={columns * 6}
                  windowSize={9}
                  columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
                  ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
                  ListEmptyComponent={(
                    <View style={{ paddingVertical: 28, alignItems: 'center', gap: 4 }}>
                      <AppText muted>No matching icons</AppText>
                      <AppText variant="caption" muted>Try another word, or use an emoji.</AppText>
                    </View>
                  )}
                  renderItem={({ item }) => {
                    return <IconCell icon={item} selected={value === item.id} onPress={() => choose(item.id)} />;
                  }}
                />
              </View>
            )}
          </MotionView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function IconCell({ icon, selected, onPress }: { icon: CatalogIcon; selected: boolean; onPress: () => void }) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  return (
    <MotionPressable
      accessibilityRole="radio"
      accessibilityLabel={t(icon.label)}
      accessibilityState={{ selected }}
      aria-checked={selected}
      active={selected}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: CELL,
          height: CELL,
          borderRadius: radius.control,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.72 : 1,
        },
        selected ? { backgroundColor: theme.accentContainer, boxShadow: theme.shadowControlPressed } : materialStyle(theme, 'control'),
      ]}>
      <AppIcon name={icon.id} color={selected ? theme.onAccentContainer : theme.text} size={26} />
      {/* Selection must not rely on the tinted fill alone. */}
      {selected ? (
        <View style={{ position: 'absolute', top: 4, end: 4 }}>
          <AppIcon name="checkmark" color={theme.onAccentContainer} size={14} />
        </View>
      ) : null}
    </MotionPressable>
  );
}
