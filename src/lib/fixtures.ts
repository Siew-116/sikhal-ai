/**
 * fixtures.ts — the canonical SikHal demo dataset.
 *
 * These are FICTIONAL records used for two purposes only:
 *   1. the "Load sample case" button on the New Case screen, and
 *   2. the automated test suite.
 *
 * They are never a substitute for production persistence. The demo path writes
 * these records into the real database; it does not bypass it.
 *
 * Supplier, customers, and products are invented. Amounts are in integer sen
 * and are deliberately chosen to include sen-level values (RM38.90, RM42.50)
 * so that rounding and formatting behaviour is visible in the demo.
 *
 * Author of the scenario: 艾简白 (Ai). Adopted as canonical by the Lead, with
 * the total verified against the row sum (RM428.40).
 */

import type { Sen } from '@/lib/core/money';
import type { Commitment } from '@/lib/core/conflict';

export interface FixtureOrderLine {
  customerId: string;
  customerName: string;
  itemName: string;
  quantity: number;
  unitPriceSen: Sen;
  /** Did the supplier cancel this line? For this fixture, all affected lines are cancelled. */
  isCancelled: boolean;
}

export interface FixturePayment {
  customerId: string;
  customerName: string;
  amountSen: Sen;
  status: 'paid' | 'partial' | 'unpaid';
  reference: string;
}

export interface DemoCase {
  supplierName: string;
  orderRef: string;
  cancellationReason: string;
  cancelledOn: string;
  orderLines: FixtureOrderLine[];
  payments: FixturePayment[];
}

/**
 * The six-customer Sarawak group-buy scenario.
 *
 * Line values and payment status:
 *   Aisyah   — 2 × RM42.00 white pepper      = RM84.00 paid in full
 *   Bala     — 1 × RM42.50 laksa paste       = RM42.50 paid in full
 *   Chen Wei — 3 × RM42.00 bundle            = RM126.00 paid in full
 *   Nurul    — 1 × RM38.90 kek lapis         = RM38.90 paid in full
 *   Daniel   — 2 units + pepper              = RM95.00 PARTIAL (line value RM123.10)
 *   Farah    — 1 × RM42.00 white pepper      = RM42.00 paid in full
 *
 * Total collected: RM84.00 + RM42.50 + RM126.00 + RM38.90 + RM95.00 + RM42.00
 *                = RM428.40  →  42840 sen
 */
export const DEMO_CASE: DemoCase = {
  supplierName: 'Kuching Harvest Trading',
  orderRef: 'GB-2024-014',
  cancellationReason:
    "Supplier's upstream supplier cancelled the shipment of Sarawak pepper and laksa paste; full order cannot be fulfilled this cycle.",
  cancelledOn: '2024-08-12',
  orderLines: [
    {
      customerId: 'CUST-001',
      customerName: 'Aisyah Rahman',
      itemName: 'Sarawak white pepper (200g)',
      quantity: 2,
      unitPriceSen: 4200,
      isCancelled: true,
    },
    {
      customerId: 'CUST-002',
      customerName: 'Bala Subramaniam',
      itemName: 'Laksa paste (500g)',
      quantity: 1,
      unitPriceSen: 4250,
      isCancelled: true,
    },
    {
      customerId: 'CUST-003',
      customerName: 'Chen Wei Ling',
      itemName: 'Sarawak pepper + laksa bundle',
      quantity: 3,
      unitPriceSen: 4200,
      isCancelled: true,
    },
    {
      customerId: 'CUST-004',
      customerName: 'Nurul Izzah',
      itemName: 'Kek Lapis Sarawak (box)',
      quantity: 1,
      unitPriceSen: 3890,
      isCancelled: true,
    },
    {
      customerId: 'CUST-005',
      customerName: 'Daniel Tan',
      itemName: 'Laksa paste (500g) ×2 + white pepper (200g)',
      quantity: 1,
      unitPriceSen: 12310,
      isCancelled: true,
    },
    {
      customerId: 'CUST-006',
      customerName: 'Farah Adibah',
      itemName: 'Sarawak white pepper (200g)',
      quantity: 1,
      unitPriceSen: 4200,
      isCancelled: true,
    },
  ],
  payments: [
    { customerId: 'CUST-001', customerName: 'Aisyah Rahman', amountSen: 8400, status: 'paid', reference: 'DUITNOW-88121' },
    { customerId: 'CUST-002', customerName: 'Bala Subramaniam', amountSen: 4250, status: 'paid', reference: 'FPX-30994' },
    { customerId: 'CUST-003', customerName: 'Chen Wei Ling', amountSen: 12600, status: 'paid', reference: 'DUITNOW-88134' },
    { customerId: 'CUST-004', customerName: 'Nurul Izzah', amountSen: 3890, status: 'paid', reference: 'EWALLET-77201' },
    { customerId: 'CUST-005', customerName: 'Daniel Tan', amountSen: 9500, status: 'partial', reference: 'DUITNOW-88147' },
    { customerId: 'CUST-006', customerName: 'Farah Adibah', amountSen: 4200, status: 'paid', reference: 'CASH-0092' },
  ],
};

/** Expected total collected for the demo case, in sen. Asserted in tests. */
export const DEMO_TOTAL_COLLECTED_SEN = 42840;

/**
 * The founder's academic commitments — the demo's Study Protection data.
 *
 * These are user-editable in the product; the fixture seeds them so the demo
 * shows a real conflict without the judge having to type a timetable.
 *
 * Day indexing: 0 = Sunday. So Monday = 1, Tuesday = 2, Thursday = 4.
 */
export const DEMO_COMMITMENTS: Array<Omit<Commitment, 'id'> & { id: string }> = [
  {
    id: 'COMMIT-001',
    label: 'CS2010 Data Structures — Lecture',
    dayOfWeek: 1, // Monday
    startMinute: 9 * 60, // 09:00
    endMinute: 11 * 60, // 11:00
    location: 'Faculty of Computer Science, Block A',
  },
  {
    id: 'COMMIT-002',
    label: 'CS2040 Algorithms — Lecture',
    dayOfWeek: 2, // Tuesday
    startMinute: 14 * 60, // 14:00
    endMinute: 16 * 60, // 16:00
    location: 'Faculty of Computer Science, LT3',
  },
  {
    id: 'COMMIT-003',
    label: 'Tutorial',
    dayOfWeek: 3, // Wednesday
    startMinute: 9 * 60,
    endMinute: 11 * 60,
    location: 'Tutorial Room 4',
  },
  {
    id: 'COMMIT-004',
    label: 'Revision group (self-declared unavailable)',
    dayOfWeek: 4, // Thursday
    startMinute: 20 * 60, // 20:00
    endMinute: 22 * 60, // 22:00
    location: 'Library, Level 2',
  },
];

/**
 * The demo's headline conflict, per Ai's two-beat demo design.
 *
 * A refund run proposed for Tuesday 14:00 collides with CS2040 Algorithms
 * (14:00–16:00). The safe alternative is Tuesday 21:30, which is clear.
 */
export const DEMO_CONFLICT_ACTION = {
  id: 'ACTION-REFUND',
  label: 'Issue customer refunds',
  dayOfWeek: 2 as const, // Tuesday
  startMinute: 14 * 60, // 14:00
  endMinute: 14 * 60 + 30, // 14:30
};

export const DEMO_SAFE_ACTION = {
  id: 'ACTION-MESSAGES',
  label: 'Send customer messages',
  dayOfWeek: 2 as const,
  startMinute: 21 * 60 + 30, // 21:30
  endMinute: 22 * 60, // 22:00
};

/**
 * Message draft template. Tone per Ai's spec: plain, warm, specific amount,
 * no over-apology, no emoji. This is the DETERMINISTIC fallback used when no
 * LLM key is configured — the UI labels it as such rather than passing it off
 * as AI-generated.
 */
export function draftMessageTemplate(
  customerName: string,
  firstName: string,
  refundFormatted: string,
  orderRef: string,
  supplierName: string,
): string {
  return (
    `Hi ${firstName}, thanks for your order in ${orderRef}. ` +
    `Unfortunately our supplier (${supplierName}) has cancelled this batch, ` +
    `so we can't fulfil your items this cycle. ` +
    `We're refunding your ${refundFormatted} in full — no action needed from you. ` +
    `Refunds are being processed from Tue 21:30, and you'll get a confirmation once it's done. ` +
    `Really sorry for the trouble, and thank you for understanding.`
  );
}
