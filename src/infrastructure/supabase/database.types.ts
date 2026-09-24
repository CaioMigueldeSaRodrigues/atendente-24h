type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type BusinessScoped = { business_id: string };
type MoneyColumns = {
  authorized_price_amount_cents: number | null;
  authorized_price_currency: string | null;
};

export type Database = {
  public: {
    Tables: {
      automotive_businesses: Table<{
        id: string; name: string; legal_name: string | null; business_type: string;
        phone: string | null; email: string | null; address: string | null;
        timezone: string; active: boolean; created_at: string; updated_at: string;
      }>;
      customers: Table<BusinessScoped & {
        id: string; name: string | null; primary_phone: string | null; email: string | null;
        preferred_contact_channel: string | null; created_at: string; updated_at: string;
      }>;
      vehicles: Table<BusinessScoped & {
        id: string; customer_id: string | null; brand: string | null; model: string | null;
        year: number | null; version: string | null; license_plate: string | null;
        mileage: number | null; created_at: string; updated_at: string;
      }>;
      conversations: Table<BusinessScoped & {
        id: string; customer_id: string | null; vehicle_id: string | null; channel: string;
        status: string; commercial_outcome: string | null; current_intent: string | null;
        started_at: string; last_message_at: string; closed_at: string | null;
      }>;
      messages: Table<BusinessScoped & {
        id: string; conversation_id: string; sender_type: string; channel: string;
        content: string; external_message_id: string | null; created_at: string;
      }>;
      opportunities: Table<BusinessScoped & {
        id: string; conversation_id: string; customer_id: string | null; vehicle_id: string | null;
        request_description: string | null; status: string; next_action: Json | null;
        estimated_value_amount_cents: number | null; estimated_value_currency: string | null;
        realized_value_amount_cents: number | null; realized_value_currency: string | null;
        value_source: string | null; created_at: string; updated_at: string; closed_at: string | null;
      }>;
      quote_requests: Table<BusinessScoped & MoneyColumns & {
        id: string; opportunity_id: string; conversation_id: string; customer_id: string | null;
        vehicle_id: string | null; request_description: string; symptom_description: string | null;
        status: string; requested_at: string; responded_at: string | null;
        created_at: string; updated_at: string;
      }>;
      appointments: Table<BusinessScoped & {
        id: string; opportunity_id: string | null; conversation_id: string; customer_id: string | null;
        vehicle_id: string | null; requested_date: string | null; requested_time: string | null;
        confirmed_start_at: string | null; status: string; request_description: string | null;
        external_appointment_id: string | null; created_at: string; updated_at: string;
      }>;
      human_handoffs: Table<BusinessScoped & {
        id: string; conversation_id: string; opportunity_id: string | null; reason: string;
        summary: string; status: string; assigned_to: string | null; requested_at: string;
        accepted_at: string | null; resolved_at: string | null; created_at: string; updated_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
