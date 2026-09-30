export interface EvolutionGoWebhookTransaction {
  run<T>(operation: () => Promise<T>): Promise<T>;
}
