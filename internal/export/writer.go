package export

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// Exporter defines the common interface for streaming tabular data directly to an output stream.
type Exporter interface {
	WriteHeader(columns []string) error
	WriteRow(row []any) error
	Flush() error
	Close() error
}

// --- CSV Exporter ---

type CSVExporter struct {
	writer *csv.Writer
}

// NewCSVExporter creates an Exporter streaming RFC 4180 CSV data.
func NewCSVExporter(w io.Writer) *CSVExporter {
	return &CSVExporter{
		writer: csv.NewWriter(w),
	}
}

func (e *CSVExporter) WriteHeader(columns []string) error {
	return e.writer.Write(columns)
}

func (e *CSVExporter) WriteRow(row []any) error {
	record := make([]string, len(row))
	for i, val := range row {
		if val == nil {
			record[i] = ""
			continue
		}
		switch v := val.(type) {
		case []byte:
			record[i] = string(v)
		default:
			record[i] = fmt.Sprint(v)
		}
	}
	return e.writer.Write(record)
}

func (e *CSVExporter) Flush() error {
	e.writer.Flush()
	return e.writer.Error()
}

func (e *CSVExporter) Close() error {
	return e.Flush()
}

// --- JSON Exporter ---

type JSONExporter struct {
	writer     *bufio.Writer
	columns    []string
	isFirstRow bool
}

// NewJSONExporter creates an Exporter streaming a JSON array of row objects.
func NewJSONExporter(w io.Writer) *JSONExporter {
	return &JSONExporter{
		writer:     bufio.NewWriter(w),
		isFirstRow: true,
	}
}

func (e *JSONExporter) WriteHeader(columns []string) error {
	e.columns = columns
	_, err := e.writer.WriteString("[\n")
	return err
}

func (e *JSONExporter) WriteRow(row []any) error {
	obj := make(map[string]any, len(e.columns))
	for i, col := range e.columns {
		if i < len(row) {
			obj[col] = row[i]
		} else {
			obj[col] = nil
		}
	}

	data, err := json.Marshal(obj)
	if err != nil {
		return err
	}

	if !e.isFirstRow {
		if _, err := e.writer.WriteString(",\n"); err != nil {
			return err
		}
	} else {
		e.isFirstRow = false
	}

	if _, err := e.writer.WriteString("  "); err != nil {
		return err
	}
	_, err = e.writer.Write(data)
	return err
}

func (e *JSONExporter) Flush() error {
	return e.writer.Flush()
}

func (e *JSONExporter) Close() error {
	if e.isFirstRow {
		// No rows were written: close as empty array or after open bracket
		if _, err := e.writer.WriteString("]\n"); err != nil {
			return err
		}
	} else {
		if _, err := e.writer.WriteString("\n]\n"); err != nil {
			return err
		}
	}
	return e.writer.Flush()
}

// --- SQL Exporter ---

type SQLExporter struct {
	writer         *bufio.Writer
	tableName      string
	dialect        string
	columns        []string
	chunkSize      int
	pendingValues  []string
	totalExported  int64
}

// NewSQLExporter creates an Exporter generating dialect-aware INSERT statements in chunks.
func NewSQLExporter(w io.Writer, tableName string, dialect string, chunkSize int) *SQLExporter {
	if chunkSize <= 0 {
		chunkSize = 100
	}
	return &SQLExporter{
		writer:    bufio.NewWriter(w),
		tableName: tableName,
		dialect:   strings.ToLower(dialect),
		chunkSize: chunkSize,
	}
}

func (e *SQLExporter) quoteIdentifier(name string) string {
	if e.dialect == "mysql" || e.dialect == "mariadb" {
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func (e *SQLExporter) quoteTable(table string) string {
	parts := strings.Split(table, ".")
	quoted := make([]string, len(parts))
	for i, p := range parts {
		quoted[i] = e.quoteIdentifier(p)
	}
	return strings.Join(quoted, ".")
}

func (e *SQLExporter) formatSQLValue(val any) string {
	if val == nil {
		return "NULL"
	}
	switch v := val.(type) {
	case bool:
		if e.dialect == "mysql" || e.dialect == "mariadb" {
			if v {
				return "1"
			}
			return "0"
		}
		if v {
			return "TRUE"
		}
		return "FALSE"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return fmt.Sprint(v)
	case []byte:
		return "'" + strings.ReplaceAll(string(v), "'", "''") + "'"
	default:
		s := fmt.Sprint(v)
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
}

func (e *SQLExporter) WriteHeader(columns []string) error {
	e.columns = columns
	return nil
}

func (e *SQLExporter) WriteRow(row []any) error {
	vals := make([]string, len(e.columns))
	for i := range e.columns {
		if i < len(row) {
			vals[i] = e.formatSQLValue(row[i])
		} else {
			vals[i] = "NULL"
		}
	}
	e.pendingValues = append(e.pendingValues, "("+strings.Join(vals, ", ")+")")
	e.totalExported++

	if len(e.pendingValues) >= e.chunkSize {
		return e.flushChunk()
	}
	return nil
}

func (e *SQLExporter) flushChunk() error {
	if len(e.pendingValues) == 0 {
		return nil
	}

	quotedCols := make([]string, len(e.columns))
	for i, c := range e.columns {
		quotedCols[i] = e.quoteIdentifier(c)
	}

	tableName := e.tableName
	if tableName == "" {
		tableName = "export_data"
	}
	quotedTable := e.quoteTable(tableName)

	stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES\n  %s;\n\n",
		quotedTable,
		strings.Join(quotedCols, ", "),
		strings.Join(e.pendingValues, ",\n  "),
	)

	_, err := e.writer.WriteString(stmt)
	e.pendingValues = e.pendingValues[:0]
	return err
}

func (e *SQLExporter) Flush() error {
	if err := e.flushChunk(); err != nil {
		return err
	}
	return e.writer.Flush()
}

func (e *SQLExporter) Close() error {
	return e.Flush()
}
