import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { TextButton } from '@/components/ui/text-button';
import { OnboardingShell } from '@/features/onboarding/onboarding-shell';
import { AccountStep } from '@/features/onboarding/steps/account-step';
import { CurrencyStep } from '@/features/onboarding/steps/currency-step';
import { ExistingUserStep } from '@/features/onboarding/steps/existing-user-step';
import { LookStep } from '@/features/onboarding/steps/look-step';
import { ReadyStep } from '@/features/onboarding/steps/ready-step';
import { WelcomeStep } from '@/features/onboarding/steps/welcome-step';
import { useOnboardingFlow } from '@/features/onboarding/use-onboarding-flow';

/**
 * First-run setup: welcome → currency → first account → look → review.
 *
 * Each step asks for one thing. Nothing is written except live appearance and
 * language previews until the final "Start using Qashy", which creates the
 * settings, the account and the starter categories in one atomic write.
 */
export function OnboardingScreen() {
  const flow = useOnboardingFlow();
  const { step, draft } = flow;

  // Android's back gesture walks back through the steps instead of leaving the app.
  const canGoBack = step !== 'welcome';
  const { back } = flow;
  useEffect(() => {
    if (process.env.EXPO_OS !== 'android' || !canGoBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, canGoBack]);

  const footer = (() => {
    switch (step) {
      case 'welcome':
        return (
          <>
            <ActionButton title="Get started" onPress={flow.next} />
            <TextButton title="I already use Qashy" tone="muted" onPress={() => flow.goTo('existing')} style={{ alignSelf: 'center' }} />
          </>
        );
      case 'existing':
        return <TextButton title="Set up as new instead" tone="muted" onPress={() => flow.goTo('currency')} style={{ alignSelf: 'center' }} />;
      case 'look':
        return (
          <>
            <ActionButton title="Continue" onPress={flow.next} />
            <TextButton title="Skip for now" tone="muted" onPress={flow.next} style={{ alignSelf: 'center' }} />
          </>
        );
      case 'ready':
        return (
          <ActionButton
            title={flow.saving ? 'Setting up…' : 'Start using Qashy'}
            icon="checkmark"
            busy={flow.saving}
            disabled={flow.saving || !flow.valid}
            onPress={() => void flow.finish()}
          />
        );
      default:
        return <ActionButton title="Continue" disabled={!flow.valid} onPress={flow.next} />;
    }
  })();

  return (
    <OnboardingShell
      stepKey={step}
      direction={flow.direction}
      progress={flow.progress}
      onBack={canGoBack ? flow.back : undefined}
      footer={footer}>
      {step === 'welcome' ? <WelcomeStep locale={draft.locale} onLocale={flow.setLocale} /> : null}
      {step === 'existing' ? <ExistingUserStep /> : null}
      {step === 'currency' ? (
        <CurrencyStep currency={draft.currency} locale={draft.locale} onCurrency={(currency) => flow.update({ currency })} />
      ) : null}
      {step === 'account' ? (
        <AccountStep draft={draft} errors={flow.errors} onChange={flow.update} onSubmit={flow.next} />
      ) : null}
      {step === 'look' ? (
        <LookStep
          themeId={draft.themeId}
          themeMode={draft.themeMode}
          accentSource={draft.accentSource}
          accentHex={draft.accentHex}
          currency={draft.currency}
          locale={draft.locale}
          onTheme={flow.setTheme}
          onThemeMode={flow.setThemeMode}
          onAccent={flow.setAccent}
        />
      ) : null}
      {step === 'ready' ? <ReadyStep draft={draft} /> : null}
    </OnboardingShell>
  );
}
