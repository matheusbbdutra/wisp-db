-- Banco de teste local para validar manualmente o driver SQLite do Wisp.
-- Gerar com: sqlite3 testdata/sample.db < testdata/seed.sql
CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);

INSERT INTO customers (name, email) VALUES
    ('Ana Silva', 'ana@example.com'),
    ('Bruno Costa', 'bruno@example.com'),
    ('Carla Souza', 'carla@example.com');
