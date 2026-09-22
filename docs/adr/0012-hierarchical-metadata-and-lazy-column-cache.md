# ADR 0012 — Catálogo Hierárquico em Duas Fases e Otimização Algorítmica de Autocomplete

**Status:** Aceito  
**Data:** 2026-09-22  

---

## 1. Contexto & Problema Algorítmico

Em bancos de dados corporativos de grande porte (ERP, multi-tenant ou microsserviços), o catálogo relacional pode conter entre centenas e dezenas de milhares de tabelas distribuídas por diversos schemas.

Identificamos três gargalos algorítmicos críticos à medida que a base cresce:

1. **Complexidade de Matching no Editor ($O(N \cdot k)$ na UI):**
   * Seja $T$ o número de tabelas e $C$ a média de colunas ($N = T \times C$).
   * Se o editor Monaco carrega todas as colunas de todas as tabelas na memória de sugestão global, cada tecla digitada (prefixo $k$) executa um filtro *fuzzy-matching* linear sobre $N$ itens.
   * Para $150.000$ colunas, isso bloqueia a thread única do JavaScript (V8) por $150\text{ms}$ a $600\text{ms}$ a cada caractere digitado, consumindo mais de $200\text{ MB}$ de heap.

2. **Degradação Superlinear do Catálogo no Banco ($O(N \log N)$ a $O(N^2)$):**
   * As views padrão do `information_schema` (`information_schema.columns`, `information_schema.tables`) contêm checagens dinâmicas de privilégios (`has_column_privilege`), múltiplos joins e subconsultas.
   * Em bancos grandes, consultar `information_schema` para todas as tabelas gera planos lentos e varreduras pesadas de metadados no servidor.
   * Views criadas por outros papéis ou *Materialized Views* (`pg_matviews`) são omitidas do `information_schema.tables`.

3. **Sobrecarga de Rede em Múltiplos RTTs ($O(S + T)$):**
   * Realizar introspecção em cascata (listar schemas $\to$ listar tabelas $\to$ listar colunas por tabela) em conexões remotas ou VPNs ($60\text{ms}$ RTT) gera tempos de carregamento de vários segundos ($150 \times 60\text{ms} = 9\text{s}$).

---

## 2. Decisão Arquitetural

Adotar uma estratégia de **Carregamento em Duas Fases (Two-Tier Hierarchical Catalog)** combinada com **Escopo Contextual no Autocomplete**:

### Fase 1: Catálogo Global Flat de Objetos ($O(T)$ — Custo Mínimo, $1\text{ RTT}$)
* Ao conectar, carregar exclusivamente os nomes dos schemas e a lista plana de tabelas/views:
  * No PostgreSQL, consultar diretamente os catálogos nativos indexados por OID (`pg_class` e `pg_namespace`), contornando o overhead do `information_schema` e suportando tabelas normais, particionadas, views e materialized views (`relkind IN ('r', 'v', 'm', 'p')`).
  * As sequences devem ser consultadas em `pg_sequences` ou `pg_class (relkind = 'S')`, eliminando erros de conversão de tipos de `information_schema.sequences`.
* O payload da Fase 1 para $10.000$ tabelas é inferior a $400\text{ KB}$, carregado instantaneamente.

### Fase 2: Resolução Lazy de Colunas & Cache Contextual ($O(C)$ por Tabela)
* **Autocomplete Contextual:** O editor Monaco analisa a query atual via regex/AST e identifica as tabelas citadas nas cláusulas `FROM` e `JOIN`.
  * As sugestões de colunas são restritas às tabelas em escopo na consulta ($N_{\text{local}} = T_{\text{query}} \times C \approx 5 \times 30 = 150$ itens).
  * A complexidade por tecla cai de $O(150.000 \cdot k)$ para **$O(150 \cdot k)$** (ganho de $1.000\times$).
* **Carregamento Sob Demanda:** As colunas detalhadas de uma tabela só são requisitadas quando:
  1. A tabela é citada no editor SQL;
  2. O usuário expande os nós da tabela na árvore lateral da UI.
* **Cache LRU Local:** As definições de colunas carregadas ficam cacheadas em memória local com política LRU (evitando consumo excessivo de RAM no frontend).

---

## 3. Consequências

* **Positivas:**
  * Conexão praticamente instantânea mesmo em bases com dezenas de milhares de tabelas.
  * Fim do *input lag* e *jank* no editor SQL ao digitar queries.
  * Suporte nativo completo a Views e Materialized Views no Postgres.
  * Tráfego de rede reduzido em mais de 90% no startup de novas abas.
* **Compensações (Trade-offs):**
  * Colunas de tabelas não citadas em `FROM/JOIN` não aparecem imediatamente no autocomplete global antes da tabela ser digitada (comportamento padrão e desejado em IDEs como DBeaver, DataGrip e VS Code).
