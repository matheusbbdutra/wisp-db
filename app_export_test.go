package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"wisp/internal/session"
)

func TestAppExportToFile(t *testing.T) {
	app := &App{
		sessions: session.NewManager(),
	}

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_export.db")
	f, err := os.Create(dbPath)
	if err != nil {
		t.Fatalf("Failed to create test db file: %v", err)
	}
	_ = f.Close()

	_, err = app.Connect("tab-export", "sqlite", dbPath)
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer app.Disconnect("tab-export")

	// Seed test data
	s, err := app.sessions.Get("tab-export")
	if err != nil {
		t.Fatalf("Failed to get session: %v", err)
	}

	initSQL := `
		CREATE TABLE items (
			id INTEGER PRIMARY KEY,
			title TEXT NOT NULL,
			price REAL,
			is_active INTEGER
		);
		INSERT INTO items (id, title, price, is_active) VALUES
			(1, 'Keyboard', 150.50, 1),
			(2, 'Mouse, Wireless', 80.00, 0),
			(3, 'Monitor "4K"', NULL, 1);
	`
	if _, err := s.Driver.Execute(context.Background(), initSQL); err != nil {
		t.Fatalf("Failed to seed items table: %v", err)
	}

	t.Run("Export to CSV", func(t *testing.T) {
		csvFile := filepath.Join(tempDir, "items.csv")
		res, err := app.ExportToFile(ExportOptions{
			TabID:    "tab-export",
			Table:    "items",
			FilePath: csvFile,
			Format:   "csv",
		})
		if err != nil {
			t.Fatalf("ExportToFile CSV failed: %v", err)
		}
		if res.TotalRows != 3 {
			t.Errorf("Expected 3 rows exported, got %d", res.TotalRows)
		}
		if res.FileSizeBytes <= 0 {
			t.Errorf("Expected non-zero file size, got %d", res.FileSizeBytes)
		}

		data, err := os.ReadFile(csvFile)
		if err != nil {
			t.Fatalf("Failed to read exported CSV: %v", err)
		}
		content := string(data)
		if !strings.Contains(content, "id,title,price,is_active") {
			t.Errorf("CSV header missing: %s", content)
		}
		if !strings.Contains(content, "\"Mouse, Wireless\"") {
			t.Errorf("CSV escaping failed: %s", content)
		}
		if !strings.Contains(content, "\"Monitor \"\"4K\"\"\"") {
			t.Errorf("CSV quote escaping failed: %s", content)
		}
	})

	t.Run("Export to JSON with custom query", func(t *testing.T) {
		jsonFile := filepath.Join(tempDir, "items.json")
		res, err := app.ExportToFile(ExportOptions{
			TabID:    "tab-export",
			Query:    "SELECT id, title FROM items WHERE is_active = 1",
			FilePath: jsonFile,
			Format:   "json",
		})
		if err != nil {
			t.Fatalf("ExportToFile JSON failed: %v", err)
		}
		if res.TotalRows != 2 {
			t.Errorf("Expected 2 rows exported, got %d", res.TotalRows)
		}

		data, err := os.ReadFile(jsonFile)
		if err != nil {
			t.Fatalf("Failed to read exported JSON: %v", err)
		}
		content := string(data)
		if !strings.Contains(content, `"title":"Keyboard"`) {
			t.Errorf("JSON missing row 1: %s", content)
		}
		if !strings.Contains(content, `"title":"Monitor \"4K\""`) {
			t.Errorf("JSON missing row 3: %s", content)
		}
	})

	t.Run("Export to SQL with chunks", func(t *testing.T) {
		sqlFile := filepath.Join(tempDir, "items.sql")
		res, err := app.ExportToFile(ExportOptions{
			TabID:     "tab-export",
			Table:     "items",
			FilePath:  sqlFile,
			Format:    "sql",
			BatchSize: 2,
		})
		if err != nil {
			t.Fatalf("ExportToFile SQL failed: %v", err)
		}
		if res.TotalRows != 3 {
			t.Errorf("Expected 3 rows exported, got %d", res.TotalRows)
		}

		data, err := os.ReadFile(sqlFile)
		if err != nil {
			t.Fatalf("Failed to read exported SQL: %v", err)
		}
		content := string(data)
		if !strings.Contains(content, "INSERT INTO \"items\" (\"id\", \"title\", \"price\", \"is_active\") VALUES") {
			t.Errorf("SQL INSERT header missing: %s", content)
		}
		if !strings.Contains(content, "'Mouse, Wireless'") {
			t.Errorf("SQL row missing: %s", content)
		}
	})
}
