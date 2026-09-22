package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/db"
	"wisp/internal/errlog"
	"wisp/internal/schemacache"
	"wisp/internal/session"
	"wisp/internal/store"
	"wisp/internal/vault"
)

// schemaCacheTTL is the schema cache lifetime (see internal/schemacache and
// docs/ARCHITECTURE.md, "Fluxo de metadados").
const schemaCacheTTL = 15 * time.Minute

// App is the root binding exposed to the frontend through Wails. It holds the Session
// Manager (tabId isolation, see internal/session), the local Store
// (connections/history/cache, see internal/store and docs/adr/0003-storage.md), and the
// two-layer schema cache (see internal/schemacache).
type App struct {
	ctx         context.Context
	sessions    *session.Manager
	store       *store.Store
	schemaCache *schemacache.Cache
	// canClose becomes true only after the frontend confirms (via ConfirmQuit) that no
	// console tab has unsaved SQL — see beforeClose.
	canClose bool
}

func NewApp() *App {
	return &App{sessions: session.NewManager()}
}

// startup is called by the Wails runtime when the window starts. It opens the local
// store at <user config>/wisp/wisp.db, creating the schema if needed.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	configDir, err := os.UserConfigDir()
	if err != nil {
		fmt.Printf("wisp: não foi possível resolver diretório de config: %v\n", err)
		return
	}

	dbDir := filepath.Join(configDir, "wisp")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		fmt.Printf("wisp: não foi possível criar %s: %v\n", dbDir, err)
		return
	}

	if err := errlog.Init(dbDir); err != nil {
		fmt.Printf("wisp: não foi possível abrir log local: %v\n", err)
	}

	v, err := vault.Open()
	if err != nil {
		fmt.Printf("wisp: não foi possível abrir credential vault: %v\n", err)
		return
	}

	s, err := store.Open(filepath.Join(dbDir, "wisp.db"), v)
	if err != nil {
		fmt.Printf("wisp: não foi possível abrir store local: %v\n", err)
		a.schemaCache = schemacache.New(schemaCacheTTL, nil)
		return
	}
	a.store = s

	// Two-layer cache (memory + Store); persistent remains nil if the Store failed to open
	// — the cache still works in memory only in that case.
	a.schemaCache = schemacache.New(schemaCacheTTL, s)
}

// shutdown closes the local store when the app exits.
func (a *App) shutdown(ctx context.Context) {
	if a.store != nil {
		a.store.Close()
	}
	_ = errlog.Close()
}

// beforeClose intercepts window closure (registered in main.go via
// options.App.OnBeforeClose) to let the frontend ask "is there unsaved SQL?" in each
// console tab before actually exiting — the same modal already used to close an
// individual tab (see ConsoleTab.tsx confirmClose), orchestrated for all tabs at once.
//
// It ALWAYS blocks the first close request (prevent=true) and emits an event for the
// frontend to decide. When the frontend finishes asking (nothing to save, or the user
// confirmed/discarded in every tab), it calls ConfirmQuit — which sets canClose and
// requests runtime.Quit again; this time beforeClose allows it (prevent=false), without
// repeatedly asking in a loop.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.canClose {
		return false
	}
	runtime.EventsEmit(ctx, "wisp:before-close")
	return true
}

// ConfirmQuit is called by the frontend after resolving (saving/discarding) unsaved SQL
// in all console tabs — or immediately if none were dirty. It sets canClose and requests
// the actual shutdown (see beforeClose).
func (a *App) ConfirmQuit() {
	a.canClose = true
	runtime.Quit(a.ctx)
}

// wispReleasesAPI is the repository release list (not .../releases/latest!) — a real bug
// avoided before implementation: GitHub's "latest" endpoint IGNORES releases marked as
// prerelease and returns 404 when no stable release exists yet (confirmed against the
// real API while developing this feature) — all Wisp releases so far are prereleases
// (v0.1.0-beta.N). The regular list is already ordered newest to oldest, so the first
// item is always the relevant one.
const wispReleasesAPI = "https://api.github.com/repos/matheusbbdutra/wisp-db/releases"

// UpdateInfo is the result of CheckForUpdate — notification only; it never downloads or
// replaces the binary on its own (Wails has no native updater, unlike Electron's
// autoUpdater/Tauri's updater).
type UpdateInfo struct {
	CurrentVersion string
	LatestVersion  string
	HTMLURL        string
	HasUpdate      bool
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

// CheckForUpdate queries the public GitHub API (no authentication or credentials
// involved) and compares against AppVersion (version.go) with semver precedence
// (see isNewerVersion): only a strictly NEWER tag counts as "update available",
// so running a build newer than the latest release stays silent instead of
// nagging. A short timeout keeps the UI from hanging if the network is
// poor/unavailable (entirely optional; never blocks any app workflow).
func (a *App) CheckForUpdate() (*UpdateInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wispReleasesAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("consultando releases do GitHub: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub respondeu %d", resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("lendo resposta do GitHub: %w", err)
	}
	if len(releases) == 0 {
		return &UpdateInfo{CurrentVersion: AppVersion, LatestVersion: AppVersion, HasUpdate: false}, nil
	}

	latest := releases[0]
	return &UpdateInfo{
		CurrentVersion: AppVersion,
		LatestVersion:  latest.TagName,
		HTMLURL:        latest.HTMLURL,
		HasUpdate:      isNewerVersion(latest.TagName, AppVersion),
	}, nil
}

// OpenReleaseURL opens the release page in the system default browser (never inside
// Wisp's own window). Restricted to https://github.com/ — never opens an arbitrary URL
// from elsewhere, only the one just returned by CheckForUpdate.
func (a *App) OpenReleaseURL(rawURL string) error {
	if !strings.HasPrefix(rawURL, "https://github.com/") {
		return fmt.Errorf("URL fora do domínio esperado")
	}
	runtime.BrowserOpenURL(a.ctx, rawURL)
	return nil
}

// --- Bindings exposed to the frontend (Wails IPC) ---

// Connect opens a dedicated connection for tab tabId using the driverName dialect
// ("sqlite" or "postgres") and the supplied dsn. Any previous connection for the same
// tab is closed (see session.Manager.Open).
func (a *App) Connect(tabID string, driverName string, dsn string) error {
	return a.connect(tabID, driverName, dsn, "")
}

// connect is the shared core of Connect (direct DSN) and ConnectSaved (saved connection)
// — an empty connectionID means "no associated saved connection" and makes RecordQuery
// skip writing history (see internal/store.RecordQuery).
func (a *App) connect(tabID string, driverName string, dsn string, connectionID string) error {
	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		return err
	}
	metadataDriver, err := db.New(db.DriverName(driverName))
	if err != nil {
		_ = driver.Close()
		return err
	}

	ctx, err := a.sessions.Open(tabID, driver, metadataDriver, schemacache.Key(driverName, dsn), connectionID)
	if err != nil {
		_ = driver.Close()
		_ = metadataDriver.Close()
		return err
	}
	if err := driver.Connect(ctx, dsn); err != nil {
		_ = metadataDriver.Close()
		return fmt.Errorf("conectando (tabId=%s): %w", tabID, err)
	}
	if err := metadataDriver.Connect(ctx, dsn); err != nil {
		_ = driver.Close()
		return fmt.Errorf("conectando conexão de metadados (tabId=%s): %w", tabID, err)
	}
	return nil
}

func metadataDriver(s *session.Session) db.DatabaseDriver {
	if s.MetadataDriver != nil {
		return s.MetadataDriver
	}
	return s.Driver
}

// QueryMetadata is the return value of RunQuery: columns/types of the started query and
// the initial execution duration (excluding the time spent fetching the rows themselves,
// measured separately in FetchRows). A struct is used instead of multiple return values
// because Wails bindings do not handle more than one value besides error well (see the
// ADR pattern already used in db.QueryResult/store.SavedConnection).
type QueryMetadata struct {
	Columns    []string
	Types      []string
	DurationMs int64
}

// FetchBatch is the return value of FetchRows: a batch of rows and whether more are
// available in the cursor.
type FetchBatch struct {
	Rows    [][]any
	HasMore bool
}

// RunQuery starts executing a query on tab tabId's connection in streaming mode — only
// column metadata is returned here; rows are fetched on demand via FetchRows, in
// batches, to avoid loading entire large results into memory (equivalent to the
// configurable "fetch size" in clients such as DBeaver, instead of fetching everything
// at once).
//
// It creates a new QueryCtx for this execution (see session.Manager.StartQuery) —
// allowing the Cancel button to abort only this query (via ctx and native driver
// cancellation), without invalidating the entire session/connection.
func (a *App) RunQuery(tabID string, query string) (*QueryMetadata, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	qctx, err := a.sessions.StartQuery(tabID)
	if err != nil {
		return nil, err
	}

	s.QueryStartedAt = time.Now()
	s.PendingQueryText = query
	s.FetchedRowCount = 0
	s.PendingHistoryID = 0

	columns, types, err := s.Driver.ExecuteStreaming(qctx, query)
	duration := time.Since(s.QueryStartedAt).Milliseconds()

	// DDL detected in the tab itself immediately invalidates this connection's schema cache
	// (see docs/ARCHITECTURE.md, "Fluxo de metadados") — without waiting for the TTL to
	// expire on its own.
	if err == nil && a.schemaCache != nil && isDDL(query) {
		a.schemaCache.Invalidate(s.CacheKey)
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wisp:catalog-invalidated", map[string]any{"tabId": tabID})
		}
	}

	if a.store != nil {
		status := "ok"
		if err != nil {
			status = "error"
		}
		id, recErr := a.store.RecordQuery(s.ConnectionID, tabID, query, status, duration, 0)
		if recErr != nil {
			fmt.Printf("wisp: não foi possível gravar histórico de query: %v\n", recErr)
		} else {
			s.PendingHistoryID = id
		}
	}

	if err != nil {
		return nil, err
	}
	return &QueryMetadata{Columns: columns, Types: types, DurationMs: duration}, nil
}

// FetchRows fetches the next batch of up to batchSize rows from the cursor opened by
// RunQuery. hasMore=false means the result is exhausted — at that point (or on an error
// during fetching), the history recorded by RunQuery is updated with the actual total
// number of rows fetched.
func (a *App) FetchRows(tabID string, batchSize int) (*FetchBatch, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return nil, err
	}

	rows, hasMore, err := s.Driver.FetchNext(s.QueryCtx, batchSize)
	s.FetchedRowCount += len(rows)

	if a.store != nil && s.PendingHistoryID != 0 {
		if err != nil {
			_ = a.store.FinishQuery(s.PendingHistoryID, "error", s.FetchedRowCount)
			s.PendingHistoryID = 0
		} else if !hasMore {
			_ = a.store.FinishQuery(s.PendingHistoryID, "ok", s.FetchedRowCount)
			s.PendingHistoryID = 0
		}
	}

	if err != nil {
		return nil, err
	}
	return &FetchBatch{Rows: rows, HasMore: hasMore}, nil
}

// isDDL detects whether a query changes the schema (CREATE/ALTER/DROP) from its first
// token — a simple lexical check, not a SQL parser (see docs/ARCHITECTURE.md, "sem
// parser SQL customizado").
func isDDL(query string) bool {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "CREATE", "ALTER", "DROP", "TRUNCATE":
		return true
	default:
		return false
	}
}

// CancelQuery interrupts the execution in progress in tab tabId, canceling the local
// context and triggering native driver cancellation when supported.
func (a *App) CancelQuery(tabID string) error {
	return a.sessions.Cancel(a.ctx, tabID)
}

// Disconnect closes and removes the session for tab tabId.
func (a *App) Disconnect(tabID string) error {
	return a.sessions.Close(tabID)
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

		for _, schema := range schemas {
			// Skip introspecting if already complete in memory
			if a.schemaCache != nil {
				if catalog, ok := a.schemaCache.Get(s.CacheKey); ok {
					if tables, ok := catalog.Tables[schema]; ok && len(tables) > 0 {
						hasColumns := true
						for _, t := range tables {
							if len(t.Columns) == 0 {
								hasColumns = false
								break
							}
						}
						if hasColumns {
							continue
						}
					}
				}
			}

			tables, err := mdDriver.IntrospectSchema(s.Ctx, schema)
			if err != nil {
				continue
			}

			if a.schemaCache != nil {
				catalog, _ := a.schemaCache.Get(s.CacheKey)
				if catalog.Tables == nil {
					catalog.Tables = make(map[string][]db.Table)
				}
				catalog.Tables[schema] = tables
				_ = a.schemaCache.Set(s.CacheKey, catalog)
			}
		}

		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wisp:catalog-updated", map[string]any{"tabId": tabID})
		}
	}()

	return nil
}

// UpdateCell updates a single cell through a parameterized UPDATE with optimistic
// concurrency checking (see db.DatabaseDriver.UpdateCell and
// docs/adr/0004-inline-edit-safety.md). It returns the affected rows — 0 means another
// process changed the row between fetch and save (not an error); the frontend warns the
// user and reverts the cell. It resolves the session by tabID just like the other
// bindings (RunQuery/IntrospectTable).
func (a *App) UpdateCell(tabID string, schema string, table string, pkColumns []string, pkValues []any, column string, oldValue any, newValue any) (int64, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return 0, err
	}
	return s.Driver.UpdateCell(s.Ctx, schema, table, pkColumns, pkValues, column, oldValue, newValue)
}

// InsertRow inserts a new row on tab tabId's connection. It resolves the session by
// tabID just like UpdateCell.
func (a *App) InsertRow(tabID string, schema string, table string, columns []string, values []any) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	return s.Driver.InsertRow(s.Ctx, schema, table, columns, values)
}

// DeleteRow deletes a row (by its real PK) on tab tabId's connection. It resolves the
// session by tabID just like UpdateCell.
func (a *App) DeleteRow(tabID string, schema string, table string, pkColumns []string, pkValues []any) (int64, error) {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return 0, err
	}
	return s.Driver.DeleteRow(s.Ctx, schema, table, pkColumns, pkValues)
}

// ExecuteBatch runs every staged INSERT/DELETE from the grid's "review changes" screen
// in a single transaction on tab tabId's connection — all-or-nothing. It resolves the
// session by tabID just like UpdateCell.
func (a *App) ExecuteBatch(tabID string, ops []db.BatchOp) error {
	s, err := a.sessions.Get(tabID)
	if err != nil {
		return err
	}
	return s.Driver.ExecuteBatch(s.Ctx, ops)
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

// --- Saved connections (persisted encrypted, see internal/vault) ---

// SaveConnection encrypts and persists a connection for future reuse (friendly name +
// driver + full DSN). It never writes the DSN in plaintext (see internal/vault).
func (a *App) SaveConnection(name string, driverName string, dsn string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveConnection(name, driverName, dsn)
}

// ListSavedConnections returns saved connections without exposing the DSN/secret.
func (a *App) ListSavedConnections() ([]store.SavedConnection, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListConnections()
}

// ConnectSaved decrypts a saved connection's DSN and uses it to open the session for tab
// tabId — the decrypted DSN is never returned to the frontend.
func (a *App) ConnectSaved(tabID string, connectionID string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	driverName, dsn, err := a.store.ResolveConnection(connectionID)
	if err != nil {
		return err
	}
	return a.connect(tabID, driverName, dsn, connectionID)
}

// TestConnection attempts to connect and immediately closes the connection, without
// persisting anything or opening a tab session — used by the connection modal to
// validate before saving (avoids saving a connection with a typo, e.g. an incorrect
// database name). A 10s timeout prevents hanging on an unreachable host.
func (a *App) TestConnection(driverName string, dsn string) error {
	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := driver.Connect(ctx, dsn); err != nil {
		return err
	}
	return driver.Close()
}

// DeleteSavedConnection permanently removes a saved connection, its history, and its schema cache.
func (a *App) DeleteSavedConnection(connectionID string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	driver, dsn, err := a.store.ResolveConnection(connectionID)
	if err == nil && a.schemaCache != nil {
		cacheKey := schemacache.Key(driver, dsn)
		a.schemaCache.Invalidate(cacheKey)
	}
	return a.store.DeleteConnection(connectionID)
}

// GetConnectionForEdit returns the driver name and decrypted DSN for a saved connection
// — used EXCLUSIVELY by the connection modal's clone flow (frontend/src/components/
// ConnectionModal.tsx). Auditing rule: this method must only be consumed by the modal,
// never by the grid, history, or any other surface. Expanding who can call this would
// leak credentials beyond the local webview. See ADR 0007 follow-up notes and the
// "clone de conexão" decision in docs/ROADMAP.md / STATE.md.
func (a *App) GetConnectionForEdit(connectionID string) (store.SavedConnectionEdit, error) {
	if a.store == nil {
		return store.SavedConnectionEdit{}, fmt.Errorf("store local indisponível")
	}
	driver, dsn, err := a.store.ResolveConnection(connectionID)
	if err != nil {
		return store.SavedConnectionEdit{}, err
	}
	return store.SavedConnectionEdit{Driver: driver, DSN: dsn}, nil
}

// GetQueryHistory returns the last N recorded executions (newest to oldest).
func (a *App) GetQueryHistory(limit int) ([]store.QueryHistoryEntry, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListQueryHistory(limit)
}

// --- Saved SQL scripts (named, editable — unlike history) ---

// SaveScript saves a new named SQL script. It returns the generated id.
func (a *App) SaveScript(name string, queryText string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveScript(name, queryText)
}

// ListScripts returns saved scripts, from most recently updated to oldest.
func (a *App) ListScripts() ([]store.SavedScript, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListScripts()
}

// UpdateScript overwrites the name and/or text of an existing script.
func (a *App) UpdateScript(id string, name string, queryText string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.UpdateScript(id, name, queryText)
}

// DeleteScript permanently removes a saved script.
func (a *App) DeleteScript(id string) error {
	if a.store == nil {
		return fmt.Errorf("store local indisponível")
	}
	return a.store.DeleteScript(id)
}

// PickSQLiteFile opens the native system dialog to select an existing SQLite database
// file (.db, .sqlite, .sqlite3). It returns the absolute path or an empty string if the
// user canceled the dialog.
func (a *App) PickSQLiteFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Selecionar banco de dados SQLite",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Bancos SQLite (*.db;*.sqlite;*.sqlite3)",
				Pattern:     "*.db;*.sqlite;*.sqlite3",
			},
			{
				DisplayName: "Todos os arquivos (*.*)",
				Pattern:     "*.*",
			},
		},
	})
}

// ReportFrontendError records an uncaught frontend error (React ErrorBoundary,
// window.onerror or unhandledrejection — see frontend/src/lib/errorReporting.ts) in the
// same local log used for Go-side panics (internal/errlog). Nothing is sent anywhere:
// this only persists locally for the user to review later in a "Report problem" flow.
func (a *App) ReportFrontendError(source string, message string, stack string) {
	errlog.Error("frontend-"+source, message, slog.String("stack", errlog.Scrub(stack)))
}
