export const OUTBOUND_DELIVERY_LEASE_MS = 60_000;

export function outboundDeliveryLeaseUntil(now: string): string {
  return new Date(Date.parse(now) + OUTBOUND_DELIVERY_LEASE_MS).toISOString();
}
