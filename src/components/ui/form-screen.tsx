import { KeyboardAvoidingView, ScrollView, type ScrollViewProps } from 'react-native';

import { ScreenTransition } from '@/components/ui/motion';
import { useQashyTheme } from '@/theme/theme';

// Shared scroll container for form screens: taps on chips and buttons land on
// the first touch while the keyboard is open, and iOS keeps the focused field
// above the keyboard.
export function FormScreen({ children, contentContainerStyle, maxWidth = 680, ...props }: ScrollViewProps & { maxWidth?: number }) {
  const theme = useQashyTheme();
  const scroll = (
    <ScreenTransition style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        // Android-only: without it, this ScrollView never registers as a nested
        // scrolling child, so the form sheet's own BottomSheetBehavior treats
        // every scroll drag as its own — collapsing or dismissing the sheet
        // instead of scrolling the content, even on an untouched form.
        nestedScrollEnabled
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={[
          { padding: 18, paddingBottom: 44, gap: 18, width: '100%', maxWidth, alignSelf: 'center' },
          contentContainerStyle,
        ]}
        {...props}>
        {children}
      </ScrollView>
    </ScreenTransition>
  );
  if (process.env.EXPO_OS === 'web') return scroll;
  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {scroll}
    </KeyboardAvoidingView>
  );
}
