package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/export"
	"wisp/internal/session"
)

// ExportOptions specifies options for exporting tabular query or table data to disk.
type ExportOptions struct {
	TabID     string `json:"tabId"`
	Query     string `json:"query,omitempty"`     // If exporting query result
	Schema    string `json:"schema,omitempty"`    // If exporting full table
	Table     string `json:"table,omitempty"`     // If exporting full table
	FilePath  string `json:"filePath"`            // Absolute path selected by user
	Format    string `json:"format"`              // "csv", "json", "sql"
	BatchSize int    `json:"batchSize,omitempty"` // Default: 1000 rows per cursor fetch
}

// ExportResult contains summary metrics after an export completes successfully.
type ExportResult struct {
	TotalRows     int64 `json:"totalRows"`
	DurationMs    int64 `json:"durationMs"`
	FileSizeBytes int64 `json:"fileSizeBytes"`
}

// PickExportFile opens a native OS save file dialog with format-specific extensions.
func (a *App) PickExportFile(defaultName string, format string) (string, error) {
	var filter runtime.FileFilter
	ext := strings.ToLower(strings.TrimPrefix(format, "."))

	switch ext {
	case "json":
		filter = runtime.FileFilter{DisplayName: "Arquivos JSON (*.json)", Pattern: "*.json"}
		if !strings.HasSuffix(strings.ToLower(defaultName), ".json") {
			defaultName += ".json"
		}
	case "sql":
		filter = runtime.FileFilter{DisplayName: "Scripts SQL (*.sql)", Pattern: "*.sql"}
		if !strings.HasSuffix(strings.ToLower(defaultName), ".sql") {
			defaultName += ".sql"
		}
	default:
		filter = runtime.FileFilter{DisplayName: "Arquivos CSV (*.csv)", Pattern: "*.csv"}
		if !strings.HasSuffix(strings.ToLower(defaultName), ".csv") {
			defaultName += ".csv"
		}
	}

	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Exportar dados para arquivo",
		Filters: []runtime.FileFilter{
			filter,
			{DisplayName: "Todos os arquivos (*.*)", Pattern: "*.*"},
		},
	})
}

// ExportToFile streams tabular query or table data directly to disk without exhausting memory.
func (a *App) ExportToFile(opts ExportOptions) (*ExportResult, error) {
	if opts.FilePath == "" {
		return nil, fmt.Errorf("caminho do arquivo não fornecido")
	}
	s, err := a.sessions.Get(opts.TabID)
	if err != nil {
		return nil, err
	}

	meta, _ := a.sessions.GetMetadata(opts.TabID)
	dialect := meta.Dialect
	if dialect == "" {
		dialect = session.DialectForDriver(meta.Driver)
	}

	query := strings.TrimSpace(opts.Query)
	var tableNameForSql string
	if query == "" {
		if opts.Table == "" {
			return nil, fmt.Errorf("consulta ou nome de tabela deve ser fornecido para exportação")
		}
		var qualified string
		if dialect == "mysql" || dialect == "mariadb" {
			if opts.Schema != "" && !strings.EqualFold(opts.Schema, "def") {
				qualified = fmt.Sprintf("`%s`.`%s`", strings.ReplaceAll(opts.Schema, "`", "``"), strings.ReplaceAll(opts.Table, "`", "``"))
			} else {
				qualified = fmt.Sprintf("`%s`", strings.ReplaceAll(opts.Table, "`", "``"))
			}
		} else {
			if opts.Schema != "" && !strings.EqualFold(opts.Schema, "main") {
				qualified = fmt.Sprintf(`"%s"."%s"`, strings.ReplaceAll(opts.Schema, `"`, `""`), strings.ReplaceAll(opts.Table, `"`, `""`))
			} else {
				qualified = fmt.Sprintf(`"%s"`, strings.ReplaceAll(opts.Table, `"`, `""`))
			}
		}
		query = fmt.Sprintf("SELECT * FROM %s", qualified)
		tableNameForSql = opts.Table
		if opts.Schema != "" {
			tableNameForSql = opts.Schema + "." + opts.Table
		}
	} else {
		if opts.Table != "" {
			tableNameForSql = opts.Table
		} else {
			tableNameForSql = "query_result"
		}
	}

	// Ensure destination directory exists
	if dir := filepath.Dir(opts.FilePath); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}

	file, err := os.Create(opts.FilePath)
	if err != nil {
		return nil, fmt.Errorf("criando arquivo de destino: %w", err)
	}

	bufWriter := bufio.NewWriterSize(file, 64*1024)
	var exp export.Exporter
	format := strings.ToLower(strings.TrimSpace(opts.Format))
	switch format {
	case "json":
		exp = export.NewJSONExporter(bufWriter)
	case "sql":
		exp = export.NewSQLExporter(bufWriter, tableNameForSql, dialect, 100)
	default:
		exp = export.NewCSVExporter(bufWriter)
	}

	qctx, err := a.sessions.StartQuery(opts.TabID)
	if err != nil {
		_ = file.Close()
		_ = os.Remove(opts.FilePath)
		return nil, err
	}

	columns, _, err := s.Driver.ExecuteStreaming(qctx, query)
	if err != nil {
		_ = file.Close()
		_ = os.Remove(opts.FilePath)
		return nil, fmt.Errorf("executando streaming para exportação: %w", err)
	}

	if err := exp.WriteHeader(columns); err != nil {
		_ = file.Close()
		_ = os.Remove(opts.FilePath)
		return nil, fmt.Errorf("escrevendo cabeçalho do arquivo: %w", err)
	}

	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = 1000
	}

	start := time.Now()
	var totalRows int64

	for {
		rows, hasMore, fetchErr := s.Driver.FetchNext(qctx, batchSize)
		if fetchErr != nil {
			_ = exp.Close()
			_ = file.Close()
			_ = os.Remove(opts.FilePath)
			return nil, fmt.Errorf("buscando linhas para exportação: %w", fetchErr)
		}

		for _, row := range rows {
			if err := exp.WriteRow(row); err != nil {
				_ = exp.Close()
				_ = file.Close()
				_ = os.Remove(opts.FilePath)
				return nil, fmt.Errorf("gravando linha no arquivo: %w", err)
			}
		}
		totalRows += int64(len(rows))

		if !hasMore {
			break
		}
	}

	if err := exp.Close(); err != nil {
		_ = file.Close()
		_ = os.Remove(opts.FilePath)
		return nil, fmt.Errorf("finalizando gravação do arquivo: %w", err)
	}

	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("fechando arquivo: %w", err)
	}

	stat, err := os.Stat(opts.FilePath)
	var fileSize int64
	if err == nil {
		fileSize = stat.Size()
	}

	return &ExportResult{
		TotalRows:     totalRows,
		DurationMs:    time.Since(start).Milliseconds(),
		FileSizeBytes: fileSize,
	}, nil
}
