package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

// SQLiteDriver implementa DatabaseDriver para arquivos SQLite locais
// (modernc.org/sqlite, puro Go — ver docs/adr/0002-cgo-policy.md).
type SQLiteDriver struct {
	conn   *sql.Conn
	pool   *sql.DB
	cursor *sql.Rows // cursor aberto por ExecuteStreaming, ver FetchNext/CloseCursor
	// cursorBinaryCols marca colunas BLOB do cursor aberto — mesmo motivo do
	// campo homônimo em PostgresDriver (ver normalizeRowSkipping).
	cursorBinaryCols []bool
}

// binaryColumnMaskSQLite marca (por índice) colunas cujo tipo declarado é
// BLOB — essas não devem virar string via normalizeRow (bytes binários
// genuínos ficariam irrecuperáveis, mesmo motivo do bytea no Postgres).
func binaryColumnMaskSQLite(colTypes []*sql.ColumnType) []bool {
	mask := make([]bool, len(colTypes))
	for i, ct := range colTypes {
		mask[i] = ct.DatabaseTypeName() == "BLOB"
	}
	return mask
}

func NewSQLiteDriver() *SQLiteDriver {
	return &SQLiteDriver{}
}

// Connect exige que o arquivo já exista — o driver subjacente (database/sql
// + modernc.org/sqlite) cria silenciosamente um banco novo vazio se o
// caminho não existir, o que faz "Conectar" a um caminho errado parecer
// bem-sucedido e só falhar depois, de forma confusa (ex.: "no such table"),
// em vez de avisar na hora. ":memory:" é a exceção óbvia (não é arquivo).
func (d *SQLiteDriver) Connect(ctx context.Context, dsn string) error {
	if dsn != ":memory:" {
		path := dsn
		if idx := strings.IndexByte(path, '?'); idx >= 0 {
			path = path[:idx]
		}
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("arquivo sqlite não encontrado: %s", path)
			}
			return fmt.Errorf("verificando arquivo sqlite %q: %w", path, err)
		}
	}

	pool, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("abrindo sqlite %q: %w", dsn, err)
	}
	conn, err := pool.Conn(ctx)
	if err != nil {
		pool.Close()
		return fmt.Errorf("obtendo conexão sqlite: %w", err)
	}
	d.pool = pool
	d.conn = conn
	return nil
}

func (d *SQLiteDriver) Close() error {
	d.CloseCursor()
	if d.conn != nil {
		d.conn.Close()
	}
	if d.pool != nil {
		return d.pool.Close()
	}
	return nil
}

func (d *SQLiteDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	rows, err := d.conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("executando query: %w", err)
	}
	defer rows.Close()
	return scanRows(rows)
}

// ExecuteStreaming inicia a query e devolve só os metadados de coluna — as
// linhas são buscadas sob demanda via FetchNext (ver docs/ARCHITECTURE.md,
// "Data Grid Virtualizado" e o pedido do usuário de paginação real em vez
// de carregar tudo de uma vez).
func (d *SQLiteDriver) ExecuteStreaming(ctx context.Context, query string) ([]string, []string, error) {
	d.CloseCursor()

	rows, err := d.conn.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("executando query: %w", err)
	}

	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, nil, err
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		rows.Close()
		return nil, nil, err
	}
	types := make([]string, len(colTypes))
	for i, ct := range colTypes {
		types[i] = ct.DatabaseTypeName()
	}

	d.cursor = rows
	d.cursorBinaryCols = binaryColumnMaskSQLite(colTypes)
	return columns, types, nil
}

func (d *SQLiteDriver) FetchNext(ctx context.Context, n int) ([][]any, bool, error) {
	if d.cursor == nil {
		return nil, false, nil
	}

	columns, err := d.cursor.Columns()
	if err != nil {
		return nil, false, err
	}

	var result [][]any
	for len(result) < n {
		if !d.cursor.Next() {
			err := d.cursor.Err()
			d.cursor.Close()
			d.cursor = nil
			return result, false, err
		}
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := d.cursor.Scan(pointers...); err != nil {
			return result, false, err
		}
		result = append(result, normalizeRowSkipping(values, d.cursorBinaryCols))
	}
	return result, true, nil
}

func (d *SQLiteDriver) CloseCursor() error {
	if d.cursor == nil {
		return nil
	}
	err := d.cursor.Close()
	d.cursor = nil
	return err
}

// CancelRunningQuery: SQLite é embutido e single-file — não há cancelamento
// nativo de servidor remoto. O ctx cancelado (Session Manager) já interrompe
// a chamada local, que é o único mecanismo aplicável aqui.
func (d *SQLiteDriver) CancelRunningQuery(ctx context.Context) error {
	return nil
}

func (d *SQLiteDriver) ListSchemas(ctx context.Context) ([]string, error) {
	// SQLite não tem conceito de schema múltiplo por padrão (fora ATTACH).
	return []string{"main"}, nil
}

func (d *SQLiteDriver) ListTables(ctx context.Context, schema string) ([]Table, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("listando tabelas: %w", err)
	}
	defer rows.Close()

	var tables []Table
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, err
		}
		tables = append(tables, Table{Schema: "main", Name: name, Kind: kind})
	}
	return tables, rows.Err()
}

// Introspect usa PRAGMA table_xinfo, que expõe a coluna "hidden": 2 e 3
// identificam colunas geradas (virtual/stored) desde o SQLite 3.31 — é o que
// alimenta IsGenerated para a checagem de segurança de edição inline
// (docs/adr/0004-inline-edit-safety.md).
func (d *SQLiteDriver) Introspect(ctx context.Context, schema, table string) (*Table, error) {
	rows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_xinfo(%q)`, table))
	if err != nil {
		return nil, fmt.Errorf("introspectando tabela %q: %w", table, err)
	}
	defer rows.Close()

	result := &Table{Schema: "main", Name: table}
	for rows.Next() {
		var cid, notNull, pk, hidden int
		var name, colType string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk, &hidden); err != nil {
			return nil, err
		}
		result.Columns = append(result.Columns, Column{
			Name:         name,
			Type:         colType,
			IsPrimaryKey: pk > 0,
			IsGenerated:  hidden == 2 || hidden == 3,
			Nullable:     notNull == 0,
		})
	}
	return result, rows.Err()
}

// IntrospectSchema é o equivalente de IntrospectSchema do Postgres, mas aqui
// o loop por tabela fica: SQLite é um arquivo local (sem round-trip de rede),
// então o custo do N+1 que motivou a versão batched do Postgres não existe
// aqui — não há requisito real pra evitar o loop.
func (d *SQLiteDriver) IntrospectSchema(ctx context.Context, schema string) ([]Table, error) {
	tables, err := d.ListTables(ctx, schema)
	if err != nil {
		return nil, err
	}
	result := make([]Table, 0, len(tables))
	for _, t := range tables {
		full, err := d.Introspect(ctx, schema, t.Name)
		if err != nil {
			return nil, err
		}
		full.Kind = t.Kind
		result = append(result, *full)
	}
	return result, nil
}

// UpdateCell executa um UPDATE parametrizado de uma única célula com
// checagem otimista de concorrência (WHERE pk = ? AND coluna_antiga = ?,
// ver docs/adr/0004-inline-edit-safety.md). Placeholders `?` nativos do
// driver; identificadores quotados, valores sempre como argumento — nunca
// concatenados no SQL.
func (d *SQLiteDriver) UpdateCell(ctx context.Context, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	query, args, err := buildUpdateCellQuery("?", schema, table, pkColumns, pkValues, column, oldValue, newValue)
	if err != nil {
		return 0, err
	}
	res, err := d.conn.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("atualizando célula de %q: %w", table, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("lendo linhas afetadas: %w", err)
	}
	return affected, nil
}

// TableDDL retorna o DDL original guardado em sqlite_master.sql — literal,
// sem reconstrução (o SQLite já persiste o CREATE TABLE verbatim).
func (d *SQLiteDriver) TableDDL(ctx context.Context, schema, table string) (string, error) {
	var ddl sql.NullString
	err := d.conn.QueryRowContext(ctx,
		`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&ddl)
	if err != nil {
		return "", fmt.Errorf("lendo DDL de %q: %w", table, err)
	}
	if !ddl.Valid {
		return "", fmt.Errorf("tabela %q não encontrada", table)
	}
	return ddl.String, nil
}

// ListTriggers lista triggers da tabela via sqlite_master (name + sql).
func (d *SQLiteDriver) ListTriggers(ctx context.Context, schema, table string) ([]Trigger, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`, table)
	if err != nil {
		return nil, fmt.Errorf("listando triggers de %q: %w", table, err)
	}
	defer rows.Close()

	var triggers []Trigger
	for rows.Next() {
		var trg Trigger
		var def sql.NullString
		if err := rows.Scan(&trg.Name, &def); err != nil {
			return nil, err
		}
		if def.Valid {
			trg.Definition = def.String
		}
		triggers = append(triggers, trg)
	}
	return triggers, rows.Err()
}

// ListFunctions: SQLite não tem função de usuário no sentido tradicional —
// retorna vazio (não é bug; o frontend mostra estado vazio com nota).
func (d *SQLiteDriver) ListFunctions(ctx context.Context, schema string) ([]Function, error) {
	return nil, nil
}

// ListIndexes lista índices explícitos da tabela via sqlite_master (exclui
// os autoindex de PK/UNIQUE, que já aparecem no TableDDL como parte da
// própria CREATE TABLE — "sqlite_autoindex_" é o prefixo interno do SQLite
// pra esses). Colunas via PRAGMA index_info, na ordem do índice.
func (d *SQLiteDriver) ListIndexes(ctx context.Context, schema, table string) ([]Index, error) {
	rows, err := d.conn.QueryContext(ctx,
		`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`, table)
	if err != nil {
		return nil, fmt.Errorf("listando índices de %q: %w", table, err)
	}
	defer rows.Close()

	var indexes []Index
	for rows.Next() {
		var idx Index
		var def sql.NullString
		if err := rows.Scan(&idx.Name, &def); err != nil {
			return nil, err
		}
		if def.Valid {
			idx.Definition = def.String
		}
		indexes = append(indexes, idx)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// PRAGMA index_list traz o flag "unique" por TABELA (não por índice) —
	// bug real corrigido em revisão de código: a versão anterior sempre
	// retornava Unique=false, então "CREATE UNIQUE INDEX" aparecia como "não"
	// na UI (resposta errada, não só ausência de informação). Lê uma vez por
	// tabela e cruza pelo nome do índice.
	uniqueByName, err := d.uniqueIndexNames(ctx, table)
	if err != nil {
		return nil, err
	}
	for i := range indexes {
		cols, err := d.indexColumns(ctx, indexes[i].Name)
		if err != nil {
			return nil, err
		}
		indexes[i].Columns = cols
		indexes[i].Unique = uniqueByName[indexes[i].Name]
	}
	return indexes, nil
}

// uniqueIndexNames lê PRAGMA index_list(tabela) e devolve o conjunto de
// nomes de índice marcados como únicos.
func (d *SQLiteDriver) uniqueIndexNames(ctx context.Context, table string) (map[string]bool, error) {
	rows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA index_list(%q)`, table))
	if err != nil {
		return nil, fmt.Errorf("lendo lista de índices de %q: %w", table, err)
	}
	defer rows.Close()

	unique := map[string]bool{}
	for rows.Next() {
		var seq int
		var name string
		var isUnique int
		var origin, partial string
		if err := rows.Scan(&seq, &name, &isUnique, &origin, &partial); err != nil {
			return nil, err
		}
		if isUnique != 0 {
			unique[name] = true
		}
	}
	return unique, rows.Err()
}

// indexColumns lê PRAGMA index_info pra pegar as colunas do índice, na
// ordem seqno.
func (d *SQLiteDriver) indexColumns(ctx context.Context, indexName string) ([]string, error) {
	infoRows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA index_info(%q)`, indexName))
	if err != nil {
		return nil, fmt.Errorf("lendo colunas do índice %q: %w", indexName, err)
	}
	defer infoRows.Close()

	var cols []string
	for infoRows.Next() {
		var seqno, cid int
		var name sql.NullString
		if err := infoRows.Scan(&seqno, &cid, &name); err != nil {
			return nil, err
		}
		if name.Valid {
			cols = append(cols, name.String)
		}
	}
	return cols, infoRows.Err()
}

// ListForeignKeys lista as FKs de saída da tabela via PRAGMA foreign_key_list.
// SQLite não nomeia FKs (sem "CONSTRAINT nome"), então Name/Definition usam
// um rótulo sintético ("fk_<id>") e uma reconstrução textual simples.
func (d *SQLiteDriver) ListForeignKeys(ctx context.Context, schema, table string) ([]ForeignKey, error) {
	rows, err := d.conn.QueryContext(ctx, fmt.Sprintf(`PRAGMA foreign_key_list(%q)`, table))
	if err != nil {
		return nil, fmt.Errorf("listando foreign keys de %q: %w", table, err)
	}
	defer rows.Close()

	byID := map[int]*ForeignKey{}
	order := []int{}
	actionsByID := map[int]string{}
	for rows.Next() {
		var id, seq int
		var refTable string
		var from, to sql.NullString
		var onUpdate, onDelete, match string
		if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return nil, err
		}
		fk, ok := byID[id]
		if !ok {
			fk = &ForeignKey{Name: fmt.Sprintf("fk_%d", id), RefSchema: "main", RefTable: refTable}
			byID[id] = fk
			order = append(order, id)
			if onDelete != "NO ACTION" {
				actionsByID[id] += " ON DELETE " + onDelete
			}
			if onUpdate != "NO ACTION" {
				actionsByID[id] += " ON UPDATE " + onUpdate
			}
		}
		if from.Valid {
			fk.Columns = append(fk.Columns, from.String)
		}
		if to.Valid {
			fk.RefColumns = append(fk.RefColumns, to.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]ForeignKey, 0, len(order))
	for _, id := range order {
		fk := byID[id]
		columns := make([]string, len(fk.Columns))
		for i, column := range fk.Columns {
			columns[i] = quoteIdent(column)
		}
		fk.Definition = fmt.Sprintf("FOREIGN KEY (%s) REFERENCES %s",
			strings.Join(columns, ", "), quoteIdent(fk.RefTable))
		if len(fk.RefColumns) > 0 {
			refColumns := make([]string, len(fk.RefColumns))
			for i, column := range fk.RefColumns {
				refColumns[i] = quoteIdent(column)
			}
			fk.Definition += " (" + strings.Join(refColumns, ", ") + ")"
		}
		fk.Definition += actionsByID[id]
		result = append(result, *fk)
	}
	return result, nil
}

// quoteIdent quota um identificador SQL com aspas duplas, escapando aspas
// internas por duplicação — evita injeção via nome de tabela/coluna.
func quoteIdent(ident string) string {
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

// buildUpdateCellQuery monta o UPDATE parametrizado compartilhado pelos
// dialetos: placeholder "?" (SQLite) ou "$n" (Postgres, qualquer outro
// valor); valores NULL na checagem otimista viram IS NULL em vez de = ?
// (NULL nunca iguala com =). A ordem dos args acompanha a numeração dos
// placeholders: PKs, valor antigo, valor novo.
func buildUpdateCellQuery(placeholder, schema, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (string, []any, error) {
	if table == "" {
		return "", nil, fmt.Errorf("tabela vazia")
	}
	if column == "" {
		return "", nil, fmt.Errorf("coluna vazia")
	}
	if len(pkColumns) == 0 {
		return "", nil, fmt.Errorf("sem colunas de chave primária para %q", table)
	}
	if len(pkColumns) != len(pkValues) {
		return "", nil, fmt.Errorf("pkColumns (%d) e pkValues (%d) divergem", len(pkColumns), len(pkValues))
	}

	next := 1
	ph := func() string {
		if placeholder == "?" {
			return "?"
		}
		s := fmt.Sprintf("$%d", next)
		next++
		return s
	}

	qualified := quoteIdent(table)
	if schema != "" && schema != "main" {
		qualified = quoteIdent(schema) + "." + qualified
	}

	// setPh precisa ser calculado ANTES do loop do WHERE: o placeholder do
	// SET aparece primeiro no texto final da query, e o binding posicional
	// do driver ("?" no SQLite) segue a ordem textual dos placeholders, não
	// a ordem de chamada em Go. args é montado na mesma ordem (newValue
	// primeiro) pra ficar consistente nos dois estilos de placeholder.
	setPh := ph()
	args := []any{newValue}

	var where []string
	for i, pk := range pkColumns {
		if pk == "" {
			return "", nil, fmt.Errorf("nome de coluna de PK vazio")
		}
		if pkValues[i] == nil {
			where = append(where, quoteIdent(pk)+" IS NULL")
			continue
		}
		where = append(where, quoteIdent(pk)+" = "+ph())
		args = append(args, pkValues[i])
	}
	if oldValue == nil {
		where = append(where, quoteIdent(column)+" IS NULL")
	} else {
		where = append(where, quoteIdent(column)+" = "+ph())
		args = append(args, oldValue)
	}

	query := fmt.Sprintf("UPDATE %s SET %s = %s WHERE %s",
		qualified, quoteIdent(column), setPh, strings.Join(where, " AND "))
	return query, args, nil
}

// scanRows converte um *sql.Rows genérico no formato de transporte comum
// {columns, types, rows} usado por todos os drivers.
func scanRows(rows *sql.Rows) (*QueryResult, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}

	types := make([]string, len(colTypes))
	for i, ct := range colTypes {
		types[i] = ct.DatabaseTypeName()
	}

	result := &QueryResult{Columns: columns, Types: types}
	binary := binaryColumnMaskSQLite(colTypes)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, normalizeRowSkipping(values, binary))
	}
	return result, rows.Err()
}
