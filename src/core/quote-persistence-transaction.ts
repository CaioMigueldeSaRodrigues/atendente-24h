export interface QuotePersistenceTransaction {
  run<T>(businessId: string, quoteRequestId: string, operation: () => Promise<T>): Promise<T>;
}
