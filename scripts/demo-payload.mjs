/**
 * Prints the canonical SikHal demo case as a JSON body for POST /api/cases.
 *
 * Kept as a separate module so the integration script exercises exactly the
 * same six-customer scenario as the UI's "Load sample case" button. The values
 * duplicate src/lib/fixtures.ts deliberately: this script must run under plain
 * Node without a TypeScript build step, but the numbers are asserted against
 * DEMO_TOTAL_COLLECTED_SEN (42840) by verify-approval-gate.sh.
 */
const payload = {
  supplierName: 'Kuching Harvest Trading',
  orderRef: 'GB-2024-014',
  cancellationReason:
    "Supplier's upstream supplier cancelled the shipment of Sarawak pepper and laksa paste; full order cannot be fulfilled this cycle.",
  cancelledOn: '2024-08-12',
  orderLines: [
    { customerId: 'CUST-001', customerName: 'Aisyah Rahman', itemName: 'Sarawak white pepper (200g)', quantity: 2, unitPriceSen: 4200, isCancelled: true },
    { customerId: 'CUST-002', customerName: 'Bala Subramaniam', itemName: 'Laksa paste (500g)', quantity: 1, unitPriceSen: 4250, isCancelled: true },
    { customerId: 'CUST-003', customerName: 'Chen Wei Ling', itemName: 'Sarawak pepper + laksa bundle', quantity: 3, unitPriceSen: 4200, isCancelled: true },
    { customerId: 'CUST-004', customerName: 'Nurul Izzah', itemName: 'Kek Lapis Sarawak (box)', quantity: 1, unitPriceSen: 3890, isCancelled: true },
    { customerId: 'CUST-005', customerName: 'Daniel Tan', itemName: 'Laksa paste (500g) ×2 + white pepper (200g)', quantity: 1, unitPriceSen: 12310, isCancelled: true },
    { customerId: 'CUST-006', customerName: 'Farah Adibah', itemName: 'Sarawak white pepper (200g)', quantity: 1, unitPriceSen: 4200, isCancelled: true },
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

process.stdout.write(JSON.stringify(payload));
