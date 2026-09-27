import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { CategoryDonut, SpendLineChart } from '@/components/finance/charts';
import { Sparkline } from '@/components/finance/sparkline';
import { StatTile } from '@/components/finance/stat-tile';
import { TransactionRow } from '@/components/finance/transaction-row';
import { ActionButton } from '@/components/ui/action-button';
import { AppText, type TextVariant } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { ChoiceListField } from '@/components/ui/choice-list-field';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { EmptyState } from '@/components/ui/empty-state';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { MonthSwitcher } from '@/components/ui/month-switcher';
import { PageHeading } from '@/components/ui/page-heading';
import { PageHero } from '@/components/ui/page-hero';
import { ProgressBar, ProgressRing } from '@/components/ui/progress-bar';
import { ScreenContainer } from '@/components/ui/screen-container';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { TextButton } from '@/components/ui/text-button';
import { UndoBar } from '@/components/ui/undo-bar';
import type { AccentSource, Category, ThemeMode, TransactionRecord } from '@/domain/models';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import type { Material } from '@/theme/materials';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { ACCENT_PRESETS, CATEGORY_PALETTE, radius, space, typeScale } from '@/theme/tokens';
import { errorMessage, showError } from '@/utils/confirm';

const TYPOGRAPHY_VARIANTS = Object.keys(typeScale) as TextVariant[];
const MATERIALS: Material[] = ['card', 'raised', 'sunken', 'control', 'controlPressed', 'accent', 'accentPressed'];
const STATUS_TONES: StatusTone[] = ['neutral', 'positive', 'warning', 'negative', 'transfer'];

const DEMO_SPARKLINE = [12, 18, 14, 22, 30, 26, 34, 29, 40];

const DEMO_DAILY_SPEND = DEMO_SPARKLINE.map((value, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  amountMinor: value * 1234,
}));

/** A fully-populated fake Category (per src/domain/models.ts) so the donut has a distinct name, color, and key per slice instead of colliding on 'uncategorized'. */
function makeDemoCategory(id: string, name: string, color: string): Category {
  return {
    id,
    revision: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    name,
    kind: 'expense',
    icon: 'cart',
    color,
    parentId: null,
    archived: false,
  };
}

const DEMO_CATEGORY_SPEND = [
  { category: makeDemoCategory('kitchen-sink-demo-category-1', 'Groceries', CATEGORY_PALETTE[0]), amountMinor: 42_00 },
  { category: makeDemoCategory('kitchen-sink-demo-category-2', 'Dining out', CATEGORY_PALETTE[1]), amountMinor: 31_50 },
  { category: null, amountMinor: 18_25 },
];

/** A fully-populated fake TransactionRecord (per src/domain/models.ts) so TransactionRow has something to render without touching the repository. */
function makeDemoTransaction(): TransactionRecord {
  return {
    id: 'kitchen-sink-demo-transaction',
    revision: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    kind: 'expense',
    status: 'posted',
    title: 'Kitchen sink demo row',
    note: '',
    localDate: '2026-09-15',
    accountId: 'demo-account',
    destinationAccountId: null,
    categoryId: 'demo-category',
    tagIds: [],
    amountMinor: 4599,
    destinationAmountMinor: null,
    destinationBaseAmountMinor: null,
    currency: 'USD',
    destinationCurrency: null,
    exchangeRate: '1',
    baseAmountMinor: 4599,
    transferGroupId: null,
    recurringRuleId: null,
    occurrenceKey: null,
  };
}

const DEMO_TRANSACTION = makeDemoTransaction();

/**
 * Dev-only component gallery, unreachable in production (see src/app/kitchen-sink.tsx,
 * which redirects to /overview unless __DEV__). Everything below uses hard-coded demo
 * data — the one exception is the theme control section at the top, which deliberately
 * writes to the real app settings through the same repository call the Appearance
 * screen uses, so accent/theme changes here can be seen across the whole app while
 * developing. That is an acceptable side effect for a page that only exists in
 * development builds.
 */
export function KitchenSinkScreen() {
  const theme = useQashyTheme();
  const repository = useFinanceRepository();
  const { settings } = useFinanceState();
  const [expectedRevision, setExpectedRevision] = useState(settings.revision);
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode);
  const [accentSource, setAccentSource] = useState<AccentSource>(settings.accentSource);
  const [accentHex, setAccentHex] = useState(settings.accentHex);

  const [demoAmount, setDemoAmount] = useState(120_00);
  const [checkboxValue, setCheckboxValue] = useState(true);
  const [segmentValue, setSegmentValue] = useState<'day' | 'week' | 'month'>('week');
  const [listFieldValue, setListFieldValue] = useState('one');
  const [month, setMonth] = useState('2026-09-01');
  const [showUndo, setShowUndo] = useState(false);

  const applyThemeSetting = async (patch: { themeMode?: ThemeMode; accentSource?: AccentSource; accentHex?: string }) => {
    try {
      const updated = await repository.updateSettings(patch, expectedRevision);
      setExpectedRevision(updated.revision);
    } catch (reason) {
      showError('Couldn’t update settings', errorMessage(reason, 'Try again.'));
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenContainer>
        <PageHeading title="Kitchen sink" subtitle="Every shared component, in one place. Dev builds only." />

        <View style={{ gap: space.md }}>
          <SectionHeader title="Theme (writes to real app settings)" />
          <Card style={{ gap: space.md }}>
            <SegmentedControl
              label="Theme mode"
              options={[
                { value: 'system', label: 'System', literal: true },
                { value: 'light', label: 'Light', literal: true },
                { value: 'dark', label: 'Dark', literal: true },
              ]}
              value={themeMode}
              onChange={(value) => {
                setThemeMode(value);
                void applyThemeSetting({ themeMode: value });
              }}
            />
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {ACCENT_PRESETS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  selected={accentSource === 'preset' && accentHex.toUpperCase() === color}
                  label={`Use ${color} accent`}
                  onPress={() => {
                    setAccentSource('preset');
                    setAccentHex(color);
                    void applyThemeSetting({ accentSource: 'preset', accentHex: color });
                  }}
                />
              ))}
            </View>
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Typography" />
          <Card style={{ gap: space.sm }}>
            {TYPOGRAPHY_VARIANTS.map((variant) => (
              <AppText key={variant} literal variant={variant}>{`${variant} — The quick brown fox`}</AppText>
            ))}
            <AppText literal variant="body">Figure vs numeric:</AppText>
            <AppText literal figure variant="body">1,234.56 (figure)</AppText>
            <AppText literal numeric variant="body">1,234.56 (numeric)</AppText>
            <AppText literal muted variant="body">Muted body text</AppText>
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Money" />
          <Card style={{ gap: space.sm }}>
            <AnimatedMoney minor={demoAmount} currency="USD" locale="en-US" variant="hero" sign />
            <AnimatedMoney minor={demoAmount} currency="ILS" locale="he-IL" variant="display" />
            <AnimatedMoney minor={demoAmount} currency="EUR" locale="de-DE" variant="money" />
            <AnimatedMoney minor={-demoAmount} currency="JPY" locale="ja-JP" variant="figure" sign />
            <AnimatedMoney minor={demoAmount} currency="USD" locale="en-US" variant="label" />
            <ActionButton title="Bump amount" icon="plus" onPress={() => setDemoAmount((value) => value + 4321)} />
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Materials" />
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {MATERIALS.map((material) => (
                <View key={material} style={{ alignItems: 'center', gap: space.xs }}>
                  <View style={[{ width: 72, height: 56, borderRadius: radius.control, borderCurve: 'continuous' }, materialStyle(theme, material)]} />
                  <AppText literal variant="caption" muted>{material}</AppText>
                </View>
              ))}
            </View>
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Card variants" />
          <Card variant="default"><AppText literal>default</AppText></Card>
          <Card variant="list">
            <AppText literal>Row one</AppText>
            <AppText literal>Row two</AppText>
            <AppText literal>Row three</AppText>
          </Card>
          <Card variant="inset"><AppText literal>inset</AppText></Card>
          <Card variant="emphasized"><AppText literal>emphasized</AppText></Card>
          <Card variant="default" onPress={() => {}}><AppText literal>pressable (has onPress)</AppText></Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Buttons" />
          <Card style={{ gap: space.sm }}>
            <ActionButton title="Primary" icon="checkmark" variant="primary" onPress={() => {}} />
            <ActionButton title="Secondary" variant="secondary" onPress={() => {}} />
            <ActionButton title="Danger" variant="danger" onPress={() => {}} />
            <ActionButton title="Large primary" size="large" onPress={() => {}} />
            <ActionButton title="Busy" busy onPress={() => {}} />
            <ActionButton title="Disabled" disabled onPress={() => {}} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <IconButton label="Plain icon button" icon="plus" variant="plain" onPress={() => {}} />
              <IconButton label="Surface icon button" icon="plus" variant="surface" onPress={() => {}} />
              <IconButton label="Accent icon button" icon="plus" variant="accent" onPress={() => {}} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <TextButton title="Accent text button" tone="accent" onPress={() => {}} />
              <TextButton title="Muted text button" tone="muted" onPress={() => {}} />
              <TextButton title="Danger text button" tone="danger" onPress={() => {}} />
            </View>
            <View style={{ alignItems: 'flex-start' }}>
              <FloatingActionButton label="Floating action button" onPress={() => {}} />
            </View>
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Inputs" />
          <Card style={{ gap: space.md }}>
            <FormField label="Normal field" literalLabel value="" onChangeText={() => {}} placeholder="Type here" />
            <FormField label="Field with hint" literalLabel value="" onChangeText={() => {}} hint="A helpful hint below the field" />
            <FormField label="Field with error" literalLabel value="bad value" onChangeText={() => {}} error="Something is wrong with this value" />
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <ChoiceChip label="Radio selected" literal selected mode="radio" onPress={() => {}} />
              <ChoiceChip label="Radio unselected" literal selected={false} mode="radio" onPress={() => {}} />
              <ChoiceChip label="Checkbox" literal selected={checkboxValue} mode="checkbox" onPress={() => setCheckboxValue((value) => !value)} />
              <ChoiceChip label="Disabled" literal selected={false} disabled mode="radio" onPress={() => {}} />
            </View>
            <SegmentedControl
              label="Period"
              options={[
                { value: 'day', label: 'Day', literal: true },
                { value: 'week', label: 'Week', literal: true },
                { value: 'month', label: 'Month', literal: true },
              ]}
              value={segmentValue}
              onChange={setSegmentValue}
            />
            <SegmentedControl
              label="Compact with icons"
              size="compact"
              options={[
                { value: 'day', label: 'Day', icon: 'sun.max', literal: true },
                { value: 'week', label: 'Week', icon: 'chart.line.uptrend.xyaxis', literal: true },
                { value: 'month', label: 'Month', icon: 'chevron.down', literal: true },
              ]}
              value={segmentValue}
              onChange={setSegmentValue}
            />
            <ChoiceListField
              label="Choice list field"
              value={listFieldValue}
              onChange={setListFieldValue}
              literalOptions
              options={[
                { value: 'one', label: 'One' },
                { value: 'two', label: 'Two', description: 'With a description' },
                { value: 'three', label: 'Three' },
              ]}
            />
            <MonthSwitcher value={month} onChange={(value) => setMonth(value)} />
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Progress" />
          <Card style={{ gap: space.md }}>
            <ProgressBar value={0} label="Zero" />
            <ProgressBar value={0.4} label="40%" />
            <ProgressBar value={1} label="100%" />
            <ProgressBar value={1.2} label="Over budget (120%)" color={theme.negative} />
            <ProgressBar value={-0.2} label="Negative" />
            <ProgressBar value={0.6} label="Thin" size="thin" />
            <ProgressBar value={0.55} label="Segmented, 7 segments" segments={7} />
            <View style={{ flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' }}>
              <ProgressRing value={0.25} label="25%">
                <AppText literal variant="caption">25%</AppText>
              </ProgressRing>
              <ProgressRing value={0.8} label="80%">
                <AppText literal variant="caption">80%</AppText>
              </ProgressRing>
              <ProgressRing value={1} label="100%">
                <AppText literal variant="caption">100%</AppText>
              </ProgressRing>
            </View>
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Finance" />
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              <StatTile label="Positive flat" value="+$120.00" tone="positive" delta={{ label: '+4.2%', tone: 'positive' }} />
              <StatTile label="Negative flat" value="-$85.00" tone="negative" delta={{ label: '-2.1%', tone: 'negative' }} />
              <StatTile label="Transfer flat" value="$50.00" tone="transfer" />
              <StatTile label="Default sunken" value="$0.00" variant="sunken" />
              <StatTile label="Positive sunken" value="+$12.00" tone="positive" variant="sunken" delta={{ label: 'up', tone: 'positive' }} />
            </View>
            <Sparkline values={DEMO_SPARKLINE} label="Demo trend sparkline" />
            <PageHero
              overline="Net worth"
              figure={<AnimatedMoney minor={demoAmount * 10} currency="USD" locale="en-US" variant="display" />}
              stats={[
                { label: 'Income', value: '$1,200.00', tone: 'positive' },
                { label: 'Expenses', value: '$850.00', tone: 'negative' },
              ]}
              footer={<Sparkline values={DEMO_SPARKLINE} label="Net worth trend" />}
            />
            <TransactionRow transaction={DEMO_TRANSACTION} onPress={() => {}} />
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Feedback" />
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {STATUS_TONES.map((tone) => (
                <StatusPill key={tone} label={tone} literal icon="checkmark" tone={tone} />
              ))}
            </View>
            <EmptyState icon="tray" title="Nothing here yet" body="This is what an empty section looks like." />
            <View style={{ gap: space.sm }}>
              <Skeleton width="100%" height={40} />
              <SkeletonText lines={3} />
            </View>
            <ActionButton title={showUndo ? 'Hide undo bar' : 'Show undo bar'} onPress={() => setShowUndo((value) => !value)} />
            {showUndo ? (
              <UndoBar message="Demo item deleted" onAction={() => setShowUndo(false)} onDismiss={() => setShowUndo(false)} />
            ) : null}
            <SpendLineChart points={DEMO_DAILY_SPEND} currency="USD" locale="en-US" />
            <CategoryDonut items={DEMO_CATEGORY_SPEND} currency="USD" locale="en-US" />
          </Card>
        </View>
      </ScreenContainer>
    </ScrollView>
  );
}
