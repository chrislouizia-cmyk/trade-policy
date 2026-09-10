import type Stripe from 'stripe';

type InvoiceLike = Stripe.Invoice & Record<string, any>;

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function invoiceTaxMinor(invoice: InvoiceLike): number {
  if (!Array.isArray(invoice.total_taxes)) return 0;

  return invoice.total_taxes.reduce((sum: number, item: unknown) => {
    if (!item || typeof item !== 'object' || !('amount' in item)) {
      return sum;
    }

    return sum + nonNegativeInteger(
      (item as {amount?: unknown}).amount,
    );
  }, 0);
}

export function affiliateEligibleAmountMinor(invoice: Stripe.Invoice): number {
  const raw = invoice as InvoiceLike;

  // Stripe's amount_paid is the economic starting point:
  // discounts/credits already reduce what was actually collected.
  const amountPaid = nonNegativeInteger(raw.amount_paid);
  if (amountPaid <= 0) return 0;

  const invoiceTotal = nonNegativeInteger(raw.total);
  const totalTax = invoiceTaxMinor(raw);

  if (totalTax <= 0 || invoiceTotal <= 0) {
    return amountPaid;
  }

  // If only part of the invoice was collected, remove only the
  // proportional tax represented by that collected amount.
  const paidRatio = Math.min(1, amountPaid / invoiceTotal);
  const paidTax = Math.round(totalTax * paidRatio);

  return Math.max(0, amountPaid - paidTax);
}

export function affiliateInvoicePaidAt(
  invoice: Stripe.Invoice,
  fallbackStripeCreated: number,
): string {
  const raw = invoice as InvoiceLike;
  const paidAt = raw.status_transitions?.paid_at;

  const unixSeconds =
    typeof paidAt === 'number' && Number.isFinite(paidAt)
      ? paidAt
      : fallbackStripeCreated;

  return new Date(unixSeconds * 1000).toISOString();
}
