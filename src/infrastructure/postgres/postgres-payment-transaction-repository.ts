import type { PostgresDatabase } from "./postgres-database.js";
import { PaymentTransactionStatus, PaymentTransactionType, type PaymentTransaction, type PaymentTransactionRepository } from "../../core/payment-transaction.js";

type Row = Record<string, unknown>;

export class PostgresPaymentTransactionRepository implements PaymentTransactionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async save(transaction: PaymentTransaction): Promise<void> {
    await this.database.query(`
      INSERT INTO payment_transactions(
        id,business_id,subscription_id,provider,provider_payment_id,type,
        amount_cents,currency,status,idempotency_key,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        provider=excluded.provider,
        provider_payment_id=excluded.provider_payment_id,
        status=excluded.status,
        updated_at=excluded.updated_at
    `, [
      transaction.id, transaction.businessId, transaction.subscriptionId, transaction.provider,
      transaction.providerPaymentId ?? null, transaction.type, transaction.amountCents,
      transaction.currency, transaction.status, transaction.idempotencyKey,
      transaction.createdAt, transaction.updatedAt,
    ]);
  }

  async findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<PaymentTransaction | null> {
    const result = await this.database.query<Row>("SELECT * FROM payment_transactions WHERE business_id=$1 AND idempotency_key=$2", [businessId, idempotencyKey]);
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }

  async listBySubscription(businessId: string, subscriptionId: string): Promise<PaymentTransaction[]> {
    const result = await this.database.query<Row>("SELECT * FROM payment_transactions WHERE business_id=$1 AND subscription_id=$2 ORDER BY created_at ASC,id ASC", [businessId, subscriptionId]);
    return result.rows.map(map);
  }
}

function map(row: Row): PaymentTransaction {
  const type = String(row.type);
  const status = String(row.status);
  if (!Object.values(PaymentTransactionType).includes(type as PaymentTransaction["type"])) throw new Error("Invalid persisted payment transaction type");
  if (!Object.values(PaymentTransactionStatus).includes(status as PaymentTransaction["status"])) throw new Error("Invalid persisted payment transaction status");
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    subscriptionId: String(row.subscription_id),
    provider: String(row.provider),
    ...(row.provider_payment_id == null ? {} : { providerPaymentId: String(row.provider_payment_id) }),
    type: type as PaymentTransaction["type"],
    amountCents: Number(row.amount_cents),
    currency: String(row.currency) as "BRL",
    status: status as PaymentTransaction["status"],
    idempotencyKey: String(row.idempotency_key),
    createdAt: dateText(row.created_at),
    updatedAt: dateText(row.updated_at),
  };
}

function dateText(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
