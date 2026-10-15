export const PaymentWebhookProcessingStatus = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
  IGNORED: "IGNORED",
} as const;

export type PaymentWebhookProcessingStatus = typeof PaymentWebhookProcessingStatus[keyof typeof PaymentWebhookProcessingStatus];

export type PaymentWebhookEvent = {
  id: string;
  businessId?: string;
  provider: string;
  providerEventId?: string;
  providerRequestId?: string;
  resourceId: string;
  eventType: string;
  payloadHash: string;
  processingStatus: PaymentWebhookProcessingStatus;
  receivedAt: string;
  processedAt?: string;
  errorMessage?: string;
};

export type PaymentWebhookEventRepository = {
  save(event: PaymentWebhookEvent): Promise<void>;
  findByProviderEventId(provider: string, providerEventId: string): Promise<PaymentWebhookEvent | null>;
  update(event: PaymentWebhookEvent): Promise<void>;
};
