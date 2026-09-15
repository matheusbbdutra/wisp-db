-- Seed do Postgres de teste local (docker-compose.yml). Cobre os casos que
-- o driver precisa introspectar corretamente (PK simples, PK composta,
-- coluna gerada, JSON/XML, índices, FKs, triggers, funções, views, múltiplos
-- schemas) — ver docs/adr/0004-inline-edit-safety.md e docs/ROADMAP.md
-- (Phase 3, itens 1 e 2). Só roda automaticamente na PRIMEIRA inicialização
-- do container (docker-entrypoint-initdb.d). Reaplicar sobre um container
-- já inicializado NÃO é suportado: o seed não é idempotente nem migra tabelas.
-- Recrie sempre do zero (apaga os dados e volumes dos bancos de teste):
-- docker compose -f testdata/docker-compose.yml down -v && docker compose -f testdata/docker-compose.yml up -d

-- ---------------------------------------------------------------------
-- Schema public: casos básicos de introspecção (PK simples/composta/coluna
-- gerada) + JSON(B)/XML pro visor de valor de célula + índice/FK/trigger/
-- função pra exploração de schema.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    profile JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO customers (name, email, profile) VALUES
    ('Ana Silva', 'ana@example.com', '{"tier": "gold", "tags": ["vip", "early-adopter"], "address": {"city": "São Paulo", "zip": "01310-000"}}'),
    ('Bruno Costa', 'bruno@example.com', '{"tier": "silver", "tags": []}'),
    ('Carla Souza', 'carla@example.com', '{"tier": "bronze", "tags": ["trial"]}')
ON CONFLICT (email) DO NOTHING;

-- PK composta — introspecção deve marcar as duas colunas como IsPrimaryKey.
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL,
    item_seq INTEGER NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    product TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (order_id, item_seq)
);

INSERT INTO order_items (order_id, item_seq, customer_id, product, quantity) VALUES
    (1, 1, 1, 'Teclado', 1),
    (1, 2, 1, 'Mouse', 2),
    (2, 1, 2, 'Monitor', 1)
ON CONFLICT (order_id, item_seq) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_order_items_customer ON order_items(customer_id);

-- Coluna gerada — introspecção deve marcar total como IsGenerated.
CREATE TABLE IF NOT EXISTS invoice_lines (
    id SERIAL PRIMARY KEY,
    unit_price NUMERIC NOT NULL,
    quantity INTEGER NOT NULL,
    total NUMERIC GENERATED ALWAYS AS (unit_price * quantity) STORED,
    metadata_xml XML
);

INSERT INTO invoice_lines (unit_price, quantity, metadata_xml) VALUES
    (10.50, 3, '<invoice><line sku="KB-100"><tax rate="0.18">true</tax></line></invoice>'),
    (99.90, 1, '<invoice><line sku="MON-27"><tax rate="0.18">false</tax></line></invoice>')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_touch ON customers;
CREATE TRIGGER trg_customers_touch
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION touch_updated_at();

DROP VIEW IF EXISTS active_customers;
CREATE VIEW active_customers AS
    SELECT id, name, email FROM customers WHERE profile->>'tier' <> 'bronze';

-- ---------------------------------------------------------------------
-- Schema sales: segundo schema pra testar navegação multi-schema (sidebar,
-- autocomplete, SchemaTab) e mais um par de FK/índice/view cruzando schemas.
-- ---------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE IF NOT EXISTS sales.regions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

INSERT INTO sales.regions (name) VALUES ('Sudeste'), ('Sul'), ('Nordeste')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales.deals (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    region_id INTEGER NOT NULL REFERENCES sales.regions(id),
    amount NUMERIC NOT NULL,
    closed_at TIMESTAMPTZ
);

INSERT INTO sales.deals (customer_id, region_id, amount, closed_at) VALUES
    (1, 1, 1500.00, now()),
    (2, 2, 800.00, NULL),
    (3, 1, 300.00, now())
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_deals_region ON sales.deals(region_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_customer_region ON sales.deals(customer_id, region_id);

DROP VIEW IF EXISTS sales.open_deals;
CREATE VIEW sales.open_deals AS
    SELECT d.id, c.name AS customer, r.name AS region, d.amount
    FROM sales.deals d
    JOIN customers c ON c.id = d.customer_id
    JOIN sales.regions r ON r.id = d.region_id
    WHERE d.closed_at IS NULL;

CREATE OR REPLACE FUNCTION sales.total_by_region(p_region_id INTEGER) RETURNS NUMERIC AS $$
    SELECT COALESCE(SUM(amount), 0) FROM sales.deals WHERE region_id = p_region_id;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Schema reporting: schema vazio de propósito (tabela única) — testa o
-- caso "schema com poucas tabelas" ao lado de "public" com várias, além
-- de servir de terceiro item pra busca da sidebar (schema com nome
-- diferente de tabela nenhuma, pra distinguir match por schema vs. tabela).
-- ---------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS reporting;

CREATE TABLE IF NOT EXISTS reporting.monthly_summary (
    year_month TEXT PRIMARY KEY,
    total_amount NUMERIC NOT NULL
);

INSERT INTO reporting.monthly_summary (year_month, total_amount) VALUES
    ('2026-08', 2600.00),
    ('2026-09', 1500.00)
ON CONFLICT (year_month) DO NOTHING;
