import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Pressable, Text, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNavigationContainerRef, type ErrorBoundaryProps } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';

import { FinanceProvider, useFinanceState } from '@/providers/finance-provider';
import { SyncProvider } from '@/providers/sync-provider';
import { PwaUpdatePrompt } from '@/components/pwa-update-prompt';
import { ReloadErrorBanner } from '@/components/reload-error-banner';
import { LocalizationProvider, useLocalization } from '@/localization/localization';
import { QashyThemeProvider, useQashyTheme } from '@/theme/theme';
import { QASHY_ACCENT } from '@/domain/defaults';
import { darkTokens, lightTokens, readableTextColor } from '@/theme/tokens';
import { FONT_ASSETS } from '@/theme/typography';

// `index` redirects to onboarding or the tabs, so anchoring the root stack to it
// gives every deep-linked route (a form sheet, /appearance, /csv, +not-found) a
// well-formed back stack, and gives Stack.Protected somewhere to send a guarded
// route instead of dropping the user on the unmatched-route screen.
export const unstable_settings = { anchor: 'index' };

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// The splash is native, so nothing rendered by React can replace it. It must be
// dismissed as soon as *anything* is renderable — including the provider's
// loading and error states — or a storage failure hides its own retry button.
function hideSplashScreen() {
  SplashScreen.hideAsync().catch(() => undefined);
}

// Matches the fallback <title> in `+html.tsx`, which is what a crawler and the
// pre-hydration paint see.
const DOCUMENT_TITLE = 'Qashy — Calm Budgeting';

/**
 * Mirrors the focused screen's `title` option into `document.title`.
 *
 * Expo Router mounts its NavigationContainer with `documentTitle: { enabled: false }`,
 * so React Navigation's own web title handling never runs and a screen `title`
 * would otherwise be inert in the browser. Doing it once here covers every route
 * that registers a title — the four tab sections, the form sheets, /appearance,
 * /csv, and +not-found — instead of each layout hand-rolling its own.
 */
function useWebDocumentTitle() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' || typeof document === 'undefined') return;
    const apply = (options: { title?: string } | undefined) => {
      document.title = options?.title ? `${options.title} · Qashy` : DOCUMENT_TITLE;
    };
    apply(navigationRef.getCurrentOptions() as { title?: string } | undefined);
    return navigationRef.addListener('options', (event) => {
      apply(event.data.options as { title?: string });
    });
  }, [navigationRef]);
}

// Every creation/editing flow gets identical sheet behaviour. Previously only
// `transaction` carried the detents and transparent content style, so the other
// six sheets opened at a different height with an opaque backdrop.
function formSheetOptions(title: string, backTitle: string) {
  return {
    headerShown: true,
    title,
    headerBackTitle: backTitle,
    // The long-press back-button menu can jump back multiple screens at
    // once, natively removing this one without ever running `usePreventRemove`'s
    // confirmation (see `useFormSheet`).
    headerBackButtonMenuEnabled: false,
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetAllowedDetents: [0.72, 1],
    contentStyle: { backgroundColor: 'transparent' },
  };
}

/**
 * Root recoverable error UI. Expo Router renders this in place of the layout, so
 * it sits above QashyThemeProvider and has to theme itself from the static token
 * sets exactly like the FinanceProvider error state does.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const tokens = scheme === 'dark' ? darkTokens : lightTokens;

  useEffect(hideSplashScreen, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: tokens.background }}>
      <Text selectable style={{ fontSize: 20, fontWeight: '700', color: tokens.text }}>Something went wrong</Text>
      <Text selectable style={{ textAlign: 'center', color: tokens.textMuted }}>
        {error.message || 'Qashy hit an unexpected error while rendering this screen.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          retry().catch(() => undefined);
        }}
        style={{ backgroundColor: QASHY_ACCENT, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }}>
        <Text style={{ color: readableTextColor(QASHY_ACCENT), fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function RootNavigator() {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const { settings } = useFinanceState();

  useWebDocumentTitle();

  // Without an explicit back title, a directly-loaded route labels its back
  // control from the anchor's route name ("index, back").
  const backTitle = t('Back');

  // app.json can only carry a single static root background colour, so the
  // Android/iOS root view is repainted here whenever the resolved theme changes.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.background).catch(() => undefined);
  }, [theme.background]);

  return (
    <>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, freezeOnBlur: false, contentStyle: { backgroundColor: theme.background } }}>
        {/* `index` only redirects, so it keeps the default document title. */}
        <Stack.Screen name="index" />
        <Stack.Screen name="+not-found" options={{ title: t('Page not found') }} />
        <Stack.Protected guard={!settings.onboardingComplete}>
          <Stack.Screen name="onboarding" options={{ title: t('Welcome') }} />
        </Stack.Protected>
        <Stack.Protected guard={settings.onboardingComplete}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="transaction" options={formSheetOptions(t('Transaction'), backTitle)} />
          <Stack.Screen name="budget" options={formSheetOptions(t('Budget'), backTitle)} />
          <Stack.Screen name="budget-adjustment" options={formSheetOptions(t('Adjust budget'), backTitle)} />
          <Stack.Screen name="goal" options={formSheetOptions(t('Goal'), backTitle)} />
          <Stack.Screen name="overview-cards" options={formSheetOptions(t('Add cards'), backTitle)} />
          <Stack.Screen name="account" options={formSheetOptions(t('Account'), backTitle)} />
          <Stack.Screen name="category" options={formSheetOptions(t('Category'), backTitle)} />
          <Stack.Screen name="recurring" options={formSheetOptions(t('Recurring transaction'), backTitle)} />
          <Stack.Screen name="exchange-rate" options={formSheetOptions(t('Exchange rate'), backTitle)} />
          <Stack.Screen name="exchange-rates" options={{ headerShown: true, title: t('Exchange rates'), headerBackTitle: backTitle }} />
          <Stack.Screen name="appearance" options={{ headerShown: true, title: t('Appearance'), headerBackTitle: backTitle }} />
          <Stack.Screen name="csv" options={{ headerShown: true, title: t('Import & export'), headerBackTitle: backTitle }} />
          <Stack.Screen name="sync" options={{ headerShown: true, title: t('Sync'), headerBackTitle: backTitle }} />
          <Stack.Screen name="sync-merge" options={{ headerShown: true, title: t('Review duplicates'), headerBackTitle: backTitle }} />
          <Stack.Screen name="sync-recovery" options={{ headerShown: true, title: t('Recovery phrase'), headerBackTitle: backTitle }} />
        </Stack.Protected>
        {/* Reachable before and after setup. Onboarding's "I already use Qashy" joins a vault
            or restores a backup on a device that has nothing yet — both screens refuse to do
            anything destructive on their own (joining is hidden on a paired device, restore
            refuses over an existing vault), so the guard adds nothing but a dead end.

            Full-screen pushes, not form sheets. Pairing puts a camera viewfinder and a
            six-word code the user must read off two screens at once; a 0.72 detent that can
            be swiped away mid-handshake is the wrong container for either. */}
        <Stack.Screen name="sync-pair" options={{ headerShown: true, title: t(settings.onboardingComplete ? 'Add a device' : 'Join your other device'), headerBackTitle: backTitle }} />
        <Stack.Screen name="sync-transfer" options={{ headerShown: true, title: t(settings.onboardingComplete ? 'Backup & transfer' : 'Restore a backup'), headerBackTitle: backTitle }} />
      </Stack>
      <PwaUpdatePrompt />
      <ReloadErrorBanner />
    </>
  );
}

export default function RootLayout() {
  // The fonts are local assets, so this resolves in a frame or two. Native waits
  // behind the splash rather than flashing the system face; web renders at once
  // (the static export must not be blank) and swaps via the CSS fallback stack.
  // A load error falls through to the system font instead of hanging the splash.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const ready = fontsLoaded || fontError != null || process.env.EXPO_OS === 'web';

  // Runs on the first renderable commit regardless of which branch FinanceProvider
  // takes, so the splash never outlives the first renderable frame.
  useEffect(() => {
    if (ready) hideSplashScreen();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* SyncProvider sits *inside* FinanceProvider deliberately. It reads the storage
          singleton directly rather than through context, but its first status read runs a
          transaction, and FinanceProvider is what awaits `storage.initialize()` before
          rendering children. Mounting it outside would race the database open. */}
      <FinanceProvider>
        <SyncProvider>
          <LocalizationProvider>
            <QashyThemeProvider>
              <RootNavigator />
            </QashyThemeProvider>
          </LocalizationProvider>
        </SyncProvider>
      </FinanceProvider>
    </GestureHandlerRootView>
  );
}
