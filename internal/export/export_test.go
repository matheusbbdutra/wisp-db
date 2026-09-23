package export

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestCSVExporter(t *testing.T) {
	var buf bytes.Buffer
	exp := NewCSVExporter(&buf)

	cols := []string{"id", "name", "notes"}
	if err := exp.WriteHeader(cols); err != nil {
		t.Fatalf("WriteHeader failed: %v", err)
	}

	rows := [][]any{
		{1, "Alice", "Normal note"},
		{2, "Bob, with comma", "Note with \"quotes\" and\nnewline"},
		{3, nil, ""},
	}

	for _, r := range rows {
		if err := exp.WriteRow(r); err != nil {
			t.Fatalf("WriteRow failed: %v", err)
		}
	}

	if err := exp.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	out := buf.String()
	expectedLines := []string{
		"id,name,notes",
		"1,Alice,Normal note",
		"2,\"Bob, with comma\",\"Note with \"\"quotes\"\" and",
		"newline\"",
		"3,,",
	}

	for _, expPart := range expectedLines {
		if !strings.Contains(out, expPart) {
			t.Errorf("Expected output to contain %q, but got:\n%s", expPart, out)
		}
	}
}

func TestJSONExporter(t *testing.T) {
	t.Run("with rows", func(t *testing.T) {
		var buf bytes.Buffer
		exp := NewJSONExporter(&buf)

		cols := []string{"id", "name", "active"}
		if err := exp.WriteHeader(cols); err != nil {
			t.Fatalf("WriteHeader failed: %v", err)
		}

		rows := [][]any{
			{int64(1), "Alice", true},
			{int64(2), "Bob", false},
			{int64(3), nil, nil},
		}

		for _, r := range rows {
			if err := exp.WriteRow(r); err != nil {
				t.Fatalf("WriteRow failed: %v", err)
			}
		}

		if err := exp.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}

		out := buf.Bytes()
		var parsed []map[string]any
		if err := json.Unmarshal(out, &parsed); err != nil {
			t.Fatalf("JSON output is invalid: %v\nOutput was:\n%s", err, string(out))
		}

		if len(parsed) != 3 {
			t.Fatalf("Expected 3 items in JSON, got %d", len(parsed))
		}

		if parsed[0]["name"] != "Alice" || parsed[0]["active"] != true {
			t.Errorf("Row 0 mismatch: %+v", parsed[0])
		}
		if parsed[2]["name"] != nil {
			t.Errorf("Row 2 mismatch, expected nil name: %+v", parsed[2])
		}
	})

	t.Run("empty rows", func(t *testing.T) {
		var buf bytes.Buffer
		exp := NewJSONExporter(&buf)

		if err := exp.WriteHeader([]string{"id"}); err != nil {
			t.Fatalf("WriteHeader failed: %v", err)
		}
		if err := exp.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}

		var parsed []any
		if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
			t.Fatalf("JSON output is invalid: %v\nOutput: %s", err, buf.String())
		}
		if len(parsed) != 0 {
			t.Errorf("Expected empty array, got %d", len(parsed))
		}
	})
}

func TestSQLExporter(t *testing.T) {
	t.Run("PostgreSQL dialect with chunks", func(t *testing.T) {
		var buf bytes.Buffer
		exp := NewSQLExporter(&buf, "public.users", "postgres", 2)

		cols := []string{"id", "username", "is_admin"}
		if err := exp.WriteHeader(cols); err != nil {
			t.Fatalf("WriteHeader failed: %v", err)
		}

		rows := [][]any{
			{1, "alice's account", true},
			{2, "bob", false},
			{3, "charlie", nil},
		}

		for _, r := range rows {
			if err := exp.WriteRow(r); err != nil {
				t.Fatalf("WriteRow failed: %v", err)
			}
		}

		if err := exp.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}

		out := buf.String()
		// Should contain 2 INSERT statements (one with 2 rows, one with 1 row)
		if strings.Count(out, "INSERT INTO \"public\".\"users\" (\"id\", \"username\", \"is_admin\") VALUES") != 2 {
			t.Errorf("Expected 2 INSERT statements, got:\n%s", out)
		}

		if !strings.Contains(out, "'alice''s account'") {
			t.Errorf("Expected escaped string 'alice''s account', got:\n%s", out)
		}
		if !strings.Contains(out, "TRUE") {
			t.Errorf("Expected TRUE for boolean, got:\n%s", out)
		}
		if !strings.Contains(out, "NULL") {
			t.Errorf("Expected NULL, got:\n%s", out)
		}
	})

	t.Run("MySQL dialect backticks and booleans", func(t *testing.T) {
		var buf bytes.Buffer
		exp := NewSQLExporter(&buf, "app_db.orders", "mysql", 10)

		cols := []string{"id", "active"}
		if err := exp.WriteHeader(cols); err != nil {
			t.Fatalf("WriteHeader failed: %v", err)
		}

		if err := exp.WriteRow([]any{10, true}); err != nil {
			t.Fatalf("WriteRow failed: %v", err)
		}

		if err := exp.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}

		out := buf.String()
		if !strings.Contains(out, "INSERT INTO `app_db`.`orders` (`id`, `active`) VALUES") {
			t.Errorf("Expected backtick quoting for MySQL, got:\n%s", out)
		}
		if !strings.Contains(out, "(10, 1);") {
			t.Errorf("Expected (10, 1) for boolean in MySQL, got:\n%s", out)
		}
	})
}
