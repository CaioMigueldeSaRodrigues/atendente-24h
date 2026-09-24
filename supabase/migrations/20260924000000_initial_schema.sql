create table public.automotive_businesses (
  id text primary key,
  name text not null,
  legal_name text,
  business_type text not null,
  phone text,
  email text,
  address text,
  timezone text not null,
  active boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table public.customers (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  name text,
  primary_phone text,
  email text,
  preferred_contact_channel text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id)
);

create table public.vehicles (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  customer_id text,
  brand text,
  model text,
  year integer,
  version text,
  license_plate text,
  mileage integer,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, customer_id) references public.customers(business_id, id)
);

create table public.conversations (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  customer_id text,
  vehicle_id text,
  channel text not null,
  status text not null,
  commercial_outcome text,
  current_intent text,
  started_at timestamptz not null,
  last_message_at timestamptz not null,
  closed_at timestamptz,
  primary key (business_id, id),
  foreign key (business_id, customer_id) references public.customers(business_id, id),
  foreign key (business_id, vehicle_id) references public.vehicles(business_id, id)
);

create table public.messages (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  conversation_id text not null,
  sender_type text not null,
  channel text not null,
  content text not null,
  external_message_id text,
  created_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, conversation_id) references public.conversations(business_id, id)
);

create table public.opportunities (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  conversation_id text not null,
  customer_id text,
  vehicle_id text,
  request_description text,
  status text not null,
  next_action jsonb,
  estimated_value_amount_cents bigint,
  estimated_value_currency text,
  realized_value_amount_cents bigint,
  realized_value_currency text,
  value_source text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  closed_at timestamptz,
  primary key (business_id, id),
  foreign key (business_id, conversation_id) references public.conversations(business_id, id),
  foreign key (business_id, customer_id) references public.customers(business_id, id),
  foreign key (business_id, vehicle_id) references public.vehicles(business_id, id)
);

create table public.quote_requests (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  opportunity_id text not null,
  conversation_id text not null,
  customer_id text,
  vehicle_id text,
  request_description text not null,
  symptom_description text,
  status text not null,
  requested_at timestamptz not null,
  responded_at timestamptz,
  authorized_price_amount_cents bigint,
  authorized_price_currency text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, opportunity_id) references public.opportunities(business_id, id),
  foreign key (business_id, conversation_id) references public.conversations(business_id, id),
  foreign key (business_id, customer_id) references public.customers(business_id, id),
  foreign key (business_id, vehicle_id) references public.vehicles(business_id, id)
);

create table public.appointments (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  opportunity_id text,
  conversation_id text not null,
  customer_id text,
  vehicle_id text,
  requested_date date,
  requested_time text,
  confirmed_start_at timestamptz,
  status text not null,
  request_description text,
  external_appointment_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, opportunity_id) references public.opportunities(business_id, id),
  foreign key (business_id, conversation_id) references public.conversations(business_id, id),
  foreign key (business_id, customer_id) references public.customers(business_id, id),
  foreign key (business_id, vehicle_id) references public.vehicles(business_id, id)
);

create table public.human_handoffs (
  id text not null,
  business_id text not null references public.automotive_businesses(id),
  conversation_id text not null,
  opportunity_id text,
  reason text not null,
  summary text not null,
  status text not null,
  assigned_to text,
  requested_at timestamptz not null,
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (business_id, id),
  foreign key (business_id, conversation_id) references public.conversations(business_id, id),
  foreign key (business_id, opportunity_id) references public.opportunities(business_id, id)
);

create index customers_business_id_idx on public.customers (business_id);
create index vehicles_business_id_idx on public.vehicles (business_id);
create index vehicles_business_customer_idx on public.vehicles (business_id, customer_id);
create index conversations_business_id_idx on public.conversations (business_id);
create index conversations_business_customer_idx on public.conversations (business_id, customer_id);
create index conversations_business_vehicle_idx on public.conversations (business_id, vehicle_id);
create index conversations_business_status_idx on public.conversations (business_id, status);
create index messages_business_id_idx on public.messages (business_id);
create index messages_business_conversation_idx on public.messages (business_id, conversation_id);
create index opportunities_business_id_idx on public.opportunities (business_id);
create index opportunities_business_conversation_idx on public.opportunities (business_id, conversation_id);
create index opportunities_business_customer_idx on public.opportunities (business_id, customer_id);
create index opportunities_business_vehicle_idx on public.opportunities (business_id, vehicle_id);
create index opportunities_business_status_idx on public.opportunities (business_id, status);
create index quote_requests_business_id_idx on public.quote_requests (business_id);
create index quote_requests_business_opportunity_idx on public.quote_requests (business_id, opportunity_id);
create index quote_requests_business_conversation_idx on public.quote_requests (business_id, conversation_id);
create index quote_requests_business_customer_idx on public.quote_requests (business_id, customer_id);
create index quote_requests_business_vehicle_idx on public.quote_requests (business_id, vehicle_id);
create index quote_requests_business_status_idx on public.quote_requests (business_id, status);
create index appointments_business_id_idx on public.appointments (business_id);
create index appointments_business_opportunity_idx on public.appointments (business_id, opportunity_id);
create index appointments_business_conversation_idx on public.appointments (business_id, conversation_id);
create index appointments_business_customer_idx on public.appointments (business_id, customer_id);
create index appointments_business_vehicle_idx on public.appointments (business_id, vehicle_id);
create index appointments_business_status_idx on public.appointments (business_id, status);
create index human_handoffs_business_id_idx on public.human_handoffs (business_id);
create index human_handoffs_business_conversation_idx on public.human_handoffs (business_id, conversation_id);
create index human_handoffs_business_opportunity_idx on public.human_handoffs (business_id, opportunity_id);
create index human_handoffs_business_status_idx on public.human_handoffs (business_id, status);
