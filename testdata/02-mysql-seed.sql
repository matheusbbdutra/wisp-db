-- Seed das tabelas MySQL/MariaDB. Roda DEPOIS de 01-init-grants.sql (ordem
-- alfabética em /docker-entrypoint-initdb.d). Cobre os casos de introspecção
-- do DatabaseDriver: PK simples, PK composta, coluna gerada, FK cross-schema,
-- índice composto, view, trigger e função.
--
-- Reset: sempre derrubar com volume (-v) antes de subir,
--   docker compose -f testdata/docker-compose.yml down -v && up -d
-- porque o MySQL só reaplica /docker-entrypoint-initdb.d no primeiro init.
-- O serviço "mariadb" usa o mesmo script (mesma sintaxe MySQL 8 / MariaDB 11).
--
-- Ordem importa: as FKs cross-schema (reporting.* -> wisp_test.*) exigem que
-- `wisp_test.customers` exista ANTES das tabelas em `reporting` que a
-- referenciam. O `01-init-grants.sql` já criou o database `reporting`.

-- Tabela pai em wisp_test (cross-schema target).
USE wisp_test;
CREATE TABLE customers (
    id      INT PRIMARY KEY AUTO_INCREMENT,
    name    VARCHAR(80) NOT NULL,
    email   VARCHAR(120) NOT NULL UNIQUE
);
INSERT INTO customers (name, email) VALUES
    ('Alice', 'alice@example.com'),
    ('Bob',   'bob@example.com');

-- Schema secundário.
USE reporting;

CREATE TABLE customers (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(120) NOT NULL,
    profile       JSON,
    -- Coluna gerada: `total` derivado de `unit_price * quantity`.
    -- `STORED` materializa o valor (MySQL 8 / MariaDB 10.5+).
    total         DECIMAL(10, 2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    unit_price    DECIMAL(10, 2) NOT NULL,
    quantity      INT NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_customers_email (email)
);

CREATE TABLE regions (
    id    INT PRIMARY KEY AUTO_INCREMENT,
    name  VARCHAR(80) NOT NULL
);
INSERT INTO regions (name) VALUES ('North'), ('South'), ('East'), ('West');

-- FK cross-schema real (reporting.deals -> wisp_test.customers).
-- Cobre o caminho de introspecção onde a tabela-filha está em schema
-- diferente do que a tabela-pai (ListForeignKeys precisa retornar o schema
-- correto na RefSchema/RefTable).
CREATE TABLE deals (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    customer_id  INT NOT NULL,
    title        VARCHAR(120) NOT NULL,
    CONSTRAINT fk_deals_customer FOREIGN KEY (customer_id) REFERENCES wisp_test.customers(id) ON DELETE CASCADE
);

CREATE TABLE orders (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    region_id   INT NOT NULL,
    amount      DECIMAL(10, 2) NOT NULL,
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    CONSTRAINT fk_orders_region   FOREIGN KEY (region_id)   REFERENCES regions(id)
);

-- PK composta.
CREATE TABLE order_items (
    order_id    INT NOT NULL,
    item_seq    INT NOT NULL,
    product     VARCHAR(120) NOT NULL,
    quantity    INT NOT NULL,
    PRIMARY KEY (order_id, item_seq)
);

-- Índice composto (cobertura pro ListIndexes / uniqueIndexNames).
CREATE INDEX idx_orders_customer_region ON orders (customer_id, region_id);

-- View simples — testa se a UI distingue view de table (Table.Kind).
CREATE VIEW open_orders AS
    SELECT id, customer_id, amount FROM orders WHERE amount > 0;

-- Trigger pra cobrir ListTriggers + DDL da TableTab.
DELIMITER //
CREATE TRIGGER trg_customers_touch
BEFORE UPDATE ON customers
FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//
DELIMITER ;

-- Função pra cobrir ListFunctions (MySQL 8+).
DELIMITER //
CREATE FUNCTION reporting.total_by_region(p_region_id INT) RETURNS DECIMAL(12, 2)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE total DECIMAL(12, 2);
    SELECT COALESCE(SUM(amount), 0) INTO total FROM orders WHERE region_id = p_region_id;
    RETURN total;
END//
DELIMITER ;

-- Dados de exemplo pra reporting.
INSERT INTO reporting.customers (name, email, unit_price, quantity)
    VALUES
        ('Alice Reporting', 'alice-r@example.com', 10.00, 2),
        ('Bob Reporting',   'bob-r@example.com',   20.00, 3),
        ('Carla',           'carla@example.com',   15.50, 1);

INSERT INTO reporting.deals (customer_id, title)
    SELECT id, CONCAT('Deal for ', name) FROM wisp_test.customers;
