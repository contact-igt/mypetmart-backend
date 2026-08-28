// Deliberately independent of OrderDetailJSON/GuestOrderDetailJSON — a
// receipt is a distinct downstream document, not a re-export of the Order
// API shape. Kept this way specifically so a future GST invoice can layer
// CustomerReceiptJSON -> CustomerInvoiceJSON (add tax breakup/HSN/seller
// GSTIN) without the Order API's own shape ever needing to change, and vice
// versa. See DocumentModels' own future-upgrade note in receipt.service.ts.

export type ReceiptItemJSON = {
  name: string;
  sku: string;
  variant: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export type ReceiptCustomerJSON = {
  name: string;
  email: string | null;
  phone: string;
};

export type ReceiptAddressJSON = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type ReceiptPaymentJSON = {
  method: string | null;
  status: string;
  transactionReference: string | null;
  paidAt: string | null;
};

export type ReceiptRefundSummaryJSON = {
  status: "processing" | "succeeded" | "failed";
  refundedAmount: string;
} | null;

export type ReceiptTotalsJSON = {
  subtotal: string;
  shippingFee: string;
  total: string;
};

export type CustomerReceiptJSON = {
  receiptNumber: string;
  receiptDate: string;
  order: {
    orderNumber: string;
    placedAt: string;
  };
  customer: ReceiptCustomerJSON;
  address: ReceiptAddressJSON;
  items: ReceiptItemJSON[];
  payment: ReceiptPaymentJSON;
  totals: ReceiptTotalsJSON;
  refundSummary: ReceiptRefundSummaryJSON;
};

// What the download endpoints actually hand back to Express — the rendered
// bytes plus a suggested file name (never a raw Order/receipt number alone,
// since a customer's own downloaded copy should read as a real file name).
export type RenderedReceipt = {
  buffer: Buffer;
  filename: string;
};
