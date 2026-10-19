/**
 * Deleting an account across two devices.
 *
 * Deleting an account converts the transfers whose other side survives into plain income or
 * expense, in place. That rewrites the whole `ledger` field group of a transaction, and the whole
 * point of a group is that a peer never observes half of one: these tests drive the real
 * repository on two real devices and look at the ops that go on the wire, then at what the peer
 * ends up holding.
 */

import { registersOf } from "@/sync/oplog";
import type { TransactionRecord } from "@/domain/models";
import {
  BASE_CURRENCY,
  expectConverged,
  makeVault,
  onboard,
  opsOf,
  sync,
} from "@/sync/engine/__tests__/vault";

async function populated() {
  const devices = await makeVault({ count: 2 });
  await onboard(devices[0]);
  await sync(devices, 3);
  return devices;
}

const savingsInput = {
  name: "Savings",
  type: "savings" as const,
  currency: BASE_CURRENCY,
  openingBalanceMinor: 10_000,
  icon: "wallet",
  color: "#3B9A69",
  archived: false,
};

describe("account deletion over sync", () => {
  it("ships a converted transfer as one whole ledger write, and the peer ends up identical", async () => {
    const [alice, bob] = await populated();
    const everyday = alice.state.accounts[0];
    const savings = await alice.repository.saveAccount(savingsInput);
    const inbound = await alice.repository.saveTransaction({
      kind: "transfer",
      title: "Top up",
      localDate: "2026-07-10",
      accountId: savings.id,
      destinationAccountId: everyday.id,
      amountMinor: 2_500,
    });
    const outbound = await alice.repository.saveTransaction({
      kind: "transfer",
      title: "Pay back",
      localDate: "2026-07-11",
      accountId: everyday.id,
      destinationAccountId: savings.id,
      amountMinor: 700,
    });
    const lunch = await alice.repository.saveTransaction({
      kind: "expense",
      title: "Lunch",
      localDate: "2026-07-12",
      accountId: savings.id,
      amountMinor: 300,
    });
    await sync([alice, bob], 3);
    expectConverged([alice, bob]);
    expect(bob.state.transactions.map((row) => row.id)).toContain(inbound.id);

    const before = await opsOf(alice);
    await alice.repository.deleteEntities("accounts", [savings.id]);
    const added = (await opsOf(alice)).filter(
      (row) => !before.some((old) => old.opId === row.opId),
    );

    // Every ledger field of each converted transfer travels together in one register write.
    const ledgerFields = registersOf("transactions")
      .find((register) => register.name === "ledger")!
      .fields.slice()
      .sort();
    for (const id of [inbound.id, outbound.id]) {
      const sets = added.filter(
        (row) =>
          row.entityType === "transactions" &&
          row.entityId === id &&
          row.kind === "set",
      );
      expect(sets).toHaveLength(1);
      // Stored rows carry the payload as the JSON string that was signed.
      const { registers } = JSON.parse(
        sets[0].payload as unknown as string,
      ) as {
        registers: Record<string, Record<string, unknown>>;
      };
      expect(Object.keys(registers.ledger).sort()).toEqual(ledgerFields);
      expect(registers.ledger).toMatchObject({
        destinationAccountId: null,
        destinationAmountMinor: null,
        destinationBaseAmountMinor: null,
        destinationCurrency: null,
        transferGroupId: null,
        foreign: null,
        fee: null,
      });
      // Nothing deletes a converted transaction.
      expect(
        added.some((row) => row.entityId === id && row.kind === "delete"),
      ).toBe(false);
    }
    expect(
      added.some((row) => row.entityId === lunch.id && row.kind === "delete"),
    ).toBe(true);
    expect(
      added.some((row) => row.entityId === savings.id && row.kind === "delete"),
    ).toBe(true);

    await sync([alice, bob], 3);
    const converged = expectConverged([alice, bob]);
    const rows = converged.transactions as unknown as TransactionRecord[];
    const byId = (id: string) => rows.find((row) => row.id === id)!;
    expect(byId(inbound.id)).toMatchObject({
      kind: "income",
      accountId: everyday.id,
      amountMinor: 2_500,
      destinationAccountId: null,
      transferGroupId: null,
      deletedAt: null,
    });
    expect(byId(outbound.id)).toMatchObject({
      kind: "expense",
      accountId: everyday.id,
      amountMinor: 700,
      destinationAccountId: null,
      deletedAt: null,
    });
    expect(rows.some((row) => row.id === lunch.id)).toBe(false);
    expect(bob.state.accounts.map((row) => row.id)).toEqual([everyday.id]);
    expect(bob.errors).toEqual([]);
    expect(alice.errors).toEqual([]);
  });

  it("converges when a peer edits the transfer while its account is deleted", async () => {
    const [alice, bob] = await populated();
    const wire = alice.wireTo(bob);
    const everyday = alice.state.accounts[0];
    const savings = await alice.repository.saveAccount(savingsInput);
    const transfer = await alice.repository.saveTransaction({
      kind: "transfer",
      title: "Top up",
      localDate: "2026-07-10",
      accountId: savings.id,
      destinationAccountId: everyday.id,
      amountMinor: 2_500,
    });
    await sync([alice, bob], 3);

    wire.partition();
    await alice.repository.deleteEntities("accounts", [savings.id]);
    // Bob renames the transfer meanwhile: a different register, so it merges with the conversion.
    const held = bob.state.transactions.find((row) => row.id === transfer.id)!;
    await bob.repository.saveTransaction(
      {
        kind: "transfer",
        title: "Top up, renamed",
        localDate: held.localDate,
        accountId: held.accountId,
        destinationAccountId: held.destinationAccountId,
        amountMinor: held.amountMinor,
        destinationAmountMinor: held.destinationAmountMinor,
        destinationBaseAmountMinor: held.destinationBaseAmountMinor,
        exchangeRate: held.exchangeRate ?? undefined,
      },
      held.id,
    );
    wire.heal();
    await sync([alice, bob], 4);

    const converged = expectConverged([alice, bob]);
    const merged = (
      converged.transactions as unknown as TransactionRecord[]
    ).filter((row) => !row.deletedAt);
    // Whichever side's ledger write won, both devices hold one coherent state with no dangling
    // account, and nobody could be left holding a half-converted transfer.
    for (const row of merged) {
      expect(row.kind === "transfer").toBe(row.destinationAccountId !== null);
      expect(row.kind === "transfer").toBe(row.transferGroupId !== null);
    }
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
  });
});
