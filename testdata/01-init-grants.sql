-- Roda ANTES do seed.sql (ordem alfabética em /docker-entrypoint-initdb.d).
-- Cria o database `reporting` e dá acesso ao usuário `wisp` criado pelo
-- entrypoint via env vars — sem isso, `wisp` só teria acesso ao database
-- default `wisp_test`, e as FKs cross-schema + introspecção do schema
-- `reporting` falhariam com "Access denied".
CREATE DATABASE IF NOT EXISTS reporting;
GRANT ALL PRIVILEGES ON reporting.* TO 'wisp'@'%';
FLUSH PRIVILEGES;
