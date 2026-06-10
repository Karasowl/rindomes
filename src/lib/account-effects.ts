import type { AppState, Transaction } from "./types";

/**
 * Applies (direction = 1) or reverses (direction = -1) a transaction's effect on
 * account balances. This is the single source of truth for how money moves between
 * accounts, shared by capture, editing, review approval, recurring payments, debt
 * payments and goal contributions/withdrawals.
 *
 * Rules:
 * - `adjustment` movements never move balances (the reconciliation already set them).
 * - Reversing only affects an already-applied (approved) movement.
 * - Transfers move money from the source account to the destination account.
 * - Income and refunds increase the account; everything else (expense, debt
 *   payment, saving, investment) decreases it.
 */
export function applyAccountEffect(
  accounts: AppState["accounts"],
  transaction: Transaction | undefined,
  direction: 1 | -1,
): AppState["accounts"] {
  if (!transaction || transaction.status === "adjustment") return accounts;
  if (direction < 0 && transaction.status !== "approved") return accounts;

  const amount = transaction.amountCents * direction;
  return accounts.map((account) => {
    if (transaction.type === "transfer") {
      if (account.id === transaction.accountId) return { ...account, balanceCents: account.balanceCents - amount };
      if (account.id === transaction.transferAccountId) return { ...account, balanceCents: account.balanceCents + amount };
      return account;
    }

    if (account.id !== transaction.accountId) return account;
    if (transaction.type === "income" || transaction.type === "refund") return { ...account, balanceCents: account.balanceCents + amount };
    return { ...account, balanceCents: account.balanceCents - amount };
  });
}
