-- Seed do Postgres de teste local (docker-compose.yml). Cobre os casos que
-- o driver precisa introspectar corretamente (PK simples, PK composta,
-- coluna gerada) — ver docs/adr/0004-inline-edit-safety.md.

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);

INSERT INTO customers (name, email) VALUES
    ('Ana Silva', 'ana@example.com'),
    ('Bruno Costa', 'bruno@example.com'),
    ('Carla Souza', 'carla@example.com');

-- PK composta — introspecção deve marcar as duas colunas como IsPrimaryKey.
CREATE TABLE order_items (
    order_id INTEGER NOT NULL,
    item_seq INTEGER NOT NULL,
    product TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (order_id, item_seq)
);

INSERT INTO order_items (order_id, item_seq, product, quantity) VALUES
    (1, 1, 'Teclado', 1),
    (1, 2, 'Mouse', 2),
    (2, 1, 'Monitor', 1);

-- Coluna gerada — introspecção deve marcar total como IsGenerated.
CREATE TABLE invoice_lines (
    id SERIAL PRIMARY KEY,
    unit_price NUMERIC NOT NULL,
    quantity INTEGER NOT NULL,
    total NUMERIC GENERATED ALWAYS AS (unit_price * quantity) STORED
);

INSERT INTO invoice_lines (unit_price, quantity) VALUES
    (10.50, 3),
    (99.90, 1);
