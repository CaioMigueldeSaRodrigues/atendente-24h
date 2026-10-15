export const PaymentTransactionType = {
  SETUP_FEE: "SETUP_FEE",
  SUBSCRIPTION: "SUBSCRIPTION",
} as const;

export type PaymentTransactionType = typeof PaymentTransactionType[keyof typeof PaymentTransactionType];

export const PaymentTransactionStatus = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
} as const;

export type PaymentTransactionStatus = typeof PaymentTransactionStatus[keyof typeof PaymentTransactionStatus];

export type PaymentTransaction = {
  id: string;
  businessId: string;
  subscriptionId: string;
  provider: string;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  providerStatus?: string;
  checkoutUrl?: string;
  type: PaymentTransactionType;
  amountCents: number;
  currency: "BRL";
  status: PaymentTransactionStatus;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentTransactionRepository = {
  save(transaction: PaymentTransaction): Promise<void>;
  findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<PaymentTransaction | null>;
  findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentTransaction | null>;
  listBySubscription(businessId: string, subscriptionId: string): Promise<PaymentTransaction[]>;
};
