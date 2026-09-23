package main

import (
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/db"
	"wisp/internal/session"
)

func metadataDriver(s *session.Session) db.DatabaseDriver {
	if s.MetadataDriver != nil {
		return s.MetadataDriver
	}
	return s.Driver
}

// ListSchemas returns the schemas visible on tab tabId's connection (used by the sidebar
// — lazy introspection, see docs/ARCHITECTURE.md). It checks the schema cache before
// querying the database and writes to the cache after an actual fetch.
func (a *App) ListSchemas(tabID string) ([]string, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok && catalog.Schemas != nil {
			return catalog.Schemas, nil
		}
	}

	schemas, err := metadataDriver(s).ListSchemas(s.Ctx)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		catalog.Schemas = schemas
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return schemas, nil
}

// ListTables returns the tables in a schema on tab tabId's connection. It uses the same
// caching logic as ListSchemas, per individual schema.
func (a *App) ListTables(tabID string, schema string) ([]db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
			if tables, ok := catalog.Tables[schema]; ok {
				return tables, nil
			}
		}
	}

	tables, err := metadataDriver(s).ListTables(s.Ctx, schema)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		catalog.Tables[schema] = tables
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return tables, nil
}

// ListSchemaObjects returns all schema objects (tables, views, functions, sequences)
// for tabID's connection within schema, grouping them in a single DTO.
func (a *App) ListSchemaObjects(tabID string, schema string) (*db.SchemaObjects, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	mdDriver := metadataDriver(s)

	allTables, err := a.ListTables(tabID, schema)
	if err != nil {
		return nil, err
	}

	var tables []db.Table
	var views []db.Table
	for _, t := range allTables {
		if strings.EqualFold(strings.TrimSpace(t.Kind), "view") {
			views = append(views, t)
		} else {
			tables = append(tables, t)
		}
	}

	functions, err := mdDriver.ListFunctions(s.Ctx, schema)
	if err != nil {
		functions = nil
	}

	sequences, err := mdDriver.ListSequences(s.Ctx, schema)
	if err != nil {
		sequences = nil
	}

	return &db.SchemaObjects{
		Tables:    tables,
		Views:     views,
		Functions: functions,
		Sequences: sequences,
	}, nil
}

// IntrospectTable returns a table with Columns populated (used for column autocomplete —
// ListTables only provides Schema/Name, see internal/db.DatabaseDriver.Introspect). It
// checks the schema cache before querying the database and writes/updates the
// corresponding cache entry after an actual fetch (the same pattern as
// ListSchemas/ListTables above).
func (a *App) IntrospectTable(tabID string, schema string, tableName string) (*db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
			if tables, ok := catalog.Tables[schema]; ok {
				for _, t := range tables {
					if t.Name == tableName && len(t.Columns) > 0 {
						cached := t
						return &cached, nil
					}
				}
			}
		}
	}

	full, err := metadataDriver(s).Introspect(s.Ctx, schema, tableName)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		tables := catalog.Tables[schema]
		replaced := false
		for i, t := range tables {
			if t.Name == tableName {
				tables[i] = *full
				replaced = true
				break
			}
		}
		if !replaced {
			tables = append(tables, *full)
		}
		catalog.Tables[schema] = tables
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return full, nil
}

// IntrospectSchemaTables returns all tables in a schema with Columns already populated,
// in a single batched query (see internal/db.DatabaseDriver.IntrospectSchema) — used by
// the console autocomplete catalog (ConsoleTab) instead of one IntrospectTable per
// table, which caused a slow queue in schemas with many tables. The same caching pattern
// as IntrospectTable: a cache hit does not query the database.
func (a *App) IntrospectSchemaTables(tabID string, schema string) ([]db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
			if tables, ok := catalog.Tables[schema]; ok {
				allDetailed := len(tables) > 0
				for _, t := range tables {
					if len(t.Columns) == 0 {
						allDetailed = false
						break
					}
				}
				if allDetailed {
					return tables, nil
				}
			}
		}
	}

	tables, err := metadataDriver(s).IntrospectSchema(s.Ctx, schema)
	if err != nil {
		return nil, err
	}

	if a.schemaCache != nil {
		catalog, _ := a.schemaCache.Get(s.CacheKey)
		if catalog.Tables == nil {
			catalog.Tables = make(map[string][]db.Table)
		}
		catalog.Tables[schema] = tables
		_ = a.schemaCache.Set(s.CacheKey, catalog)
	}
	return tables, nil
}

// RefreshSchema invalidates the cache for tab tabId's connection — used by the sidebar's
// "Refresh" button to force an actual fetch instead of waiting for the TTL.
func (a *App) RefreshSchema(tabID string) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	if a.schemaCache != nil {
		a.schemaCache.Invalidate(s.CacheKey)
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wisp:catalog-invalidated", map[string]any{"tabId": tabID})
		}
	}
	return nil
}

// GetCachedCatalog returns all currently cached detailed tables across all schemas for tabID
// without hitting the database, allowing instant autocomplete initialization.
func (a *App) GetCachedCatalog(tabID string) ([]db.Table, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	if a.schemaCache == nil {
		return nil, nil
	}
	catalog, ok := a.schemaCache.Get(s.CacheKey)
	if !ok || catalog.Tables == nil {
		return nil, nil
	}
	var all []db.Table
	for _, tables := range catalog.Tables {
		all = append(all, tables...)
	}
	return all, nil
}

// WarmupCatalog asynchronously warms and updates the schema cache in background,
// emitting wisp:catalog-updated upon completion without blocking the interactive query queue.
func (a *App) WarmupCatalog(tabID string) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}

	go func() {
		mdDriver := metadataDriver(s)
		schemas, err := mdDriver.ListSchemas(s.Ctx)
		if err != nil {
			return
		}

		if a.schemaCache != nil {
			catalog, _ := a.schemaCache.Get(s.CacheKey)
			catalog.Schemas = schemas
			if catalog.Tables == nil {
				catalog.Tables = make(map[string][]db.Table)
			}
			_ = a.schemaCache.Set(s.CacheKey, catalog)
		}

		// Phase 1 (ADR 0012): Fast flat table listing per schema (O(T)) without eager column join
		for _, schema := range schemas {
			existingMap := make(map[string]db.Table)
			if a.schemaCache != nil {
				if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
					for _, t := range catalog.Tables[schema] {
						if len(t.Columns) > 0 {
							existingMap[t.Name] = t
						}
					}
				}
			}

			flatTables, err := mdDriver.ListTables(s.Ctx, schema)
			if err != nil {
				continue
			}

			// Merge: keep introspected columns for tables that were already loaded
			merged := make([]db.Table, len(flatTables))
			for i, ft := range flatTables {
				if existing, ok := existingMap[ft.Name]; ok && len(existing.Columns) > 0 {
					merged[i] = existing
				} else {
					merged[i] = ft
				}
			}

			if a.schemaCache != nil {
				catalog, _ := a.schemaCache.Get(s.CacheKey)
				if catalog.Tables == nil {
					catalog.Tables = make(map[string][]db.Table)
				}
				catalog.Tables[schema] = merged
				_ = a.schemaCache.Set(s.CacheKey, catalog)
			}
		}

		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wisp:catalog-updated", map[string]any{"tabId": tabID})
		}
	}()

	return nil
}

// ListIncomingForeignKeys lists FKs on OTHER tables that reference this table's columns
// on tab tabId's connection — used to warn about ON DELETE CASCADE before a batch
// delete. It resolves the session by tabID just like IntrospectTable.
func (a *App) ListIncomingForeignKeys(tabID string, schema string, table string) ([]db.IncomingForeignKey, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListIncomingForeignKeys(s.Ctx, schema, table)
}

// GetTableDDL returns the table creation DDL on tab tabId's connection. It resolves the
// session by tabID just like IntrospectTable.
func (a *App) GetTableDDL(tabID string, schema string, table string) (string, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return "", err
	}
	return s.Driver.TableDDL(s.Ctx, schema, table)
}

// ListTriggers lists table triggers on tab tabId's connection. It resolves the session
// by tabID just like IntrospectTable.
func (a *App) ListTriggers(tabID string, schema string, table string) ([]db.Trigger, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListTriggers(s.Ctx, schema, table)
}

// ListFunctions lists schema functions on tab tabId's connection (schema level, not
// filtered by table). It resolves the session by tabID just like IntrospectTable.
func (a *App) ListFunctions(tabID string, schema string) ([]db.Function, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListFunctions(s.Ctx, schema)
}

// ListIndexes lists table indexes on tab tabId's connection. It resolves the session by
// tabID just like IntrospectTable.
func (a *App) ListIndexes(tabID string, schema string, table string) ([]db.Index, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListIndexes(s.Ctx, schema, table)
}

// ListForeignKeys lists the table's outgoing FKs on tab tabId's connection. It resolves
// the session by tabID just like IntrospectTable.
func (a *App) ListForeignKeys(tabID string, schema string, table string) ([]db.ForeignKey, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}
	return s.Driver.ListForeignKeys(s.Ctx, schema, table)
}
