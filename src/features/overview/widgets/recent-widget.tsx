import { router } from 'expo-router';
import { View } from 'react-native';

import { TransactionRow } from '@/components/finance/transaction-row';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MotionView } from '@/components/ui/motion';
import { SectionHeader } from '@/components/ui/section-header';
import { useFinanceState } from '@/providers/finance-provider';
import { useQashyTheme } from '@/theme/theme';
import { monthKey, monthLabel } from '@/utils/date';
import type { WidgetProps } from '@/features/overview/widgets/types';
import { useDashboard } from '@/features/overview/widgets/use-dashboard';

export function RecentWidget({ month }: WidgetProps) {
  const { space } = useQashyTheme();
  const state = useFinanceState();
  const summary = useDashboard(month);
  const locale = state.settings.locale;
  const seeMonth = () => router.push({ pathname: '/transactions', params: { month: monthKey(month) } });

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader title="Recent activity" action="See all" onAction={seeMonth} />
      {summary.recentTransactions.length ? (
        <Card variant="list">
          {summary.recentTransactions.map((transaction) => (
            <MotionView key={transaction.id} variant="fade" animateLayout exit>
              <TransactionRow transaction={transaction} returnTo="/overview" />
            </MotionView>
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState
            compact
            icon="arrow.left.arrow.right"
            title={state.transactions.length ? `No activity in ${monthLabel(month, locale)}` : 'Your ledger is ready'}
            body={state.transactions.length ? 'Choose another month or open the full transaction list.' : 'Add the first transaction and Qashy will turn it into useful context.'}>
            {state.transactions.length ? (
              <ActionButton title="See all transactions" variant="secondary" onPress={seeMonth} />
            ) : (
              <ActionButton title="Add transaction" icon="plus" onPress={() => router.push({ pathname: '/transaction', params: { returnTo: '/overview' } })} />
            )}
          </EmptyState>
        </Card>
      )}
    </View>
  );
}
