// Package schemacache implements the two-layer schema metadata cache described in
// docs/ARCHITECTURE.md ("Fluxo de metadados"): memory (fast, lives while the connection
// is active) + optional persistence (survives across sessions). Configurable TTL, manual
// invalidation, and invalidation on detected DDL (see App.Execute in app.go).
//
// A connection's cache identity is never the plaintext DSN (which contains credentials)
// — it is a SHA-256 hash of "driver|dsn" (see Key).
package schemacache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"wisp/internal/db"
)

// Catalog is the cached content for a connection: the schema list and, for schemas
// already expanded in the sidebar, the table list.
type Catalog struct {
	Schemas []string              `json:"schemas"`
	Tables  map[string][]db.Table `json:"tables"`
}

// PersistentStore is the minimal contract satisfied by internal/store.Store (structural
// satisfaction, no direct import — avoids coupling this package to the store's full
// SQLite schema).
type PersistentStore interface {
	GetSchemaCacheJSON(cacheKey string) (catalogJSON string, found bool, err error)
	SetSchemaCacheJSON(cacheKey string, catalogJSON string, ttl time.Duration) error
	DeleteSchemaCacheJSON(cacheKey string) error
}

type entry struct {
	catalog   Catalog
	expiresAt time.Time
}

// Cache combines the in-memory layer with an optional persistent layer (persistent may
// be nil — the cache then lives only in memory, still valid within the same app run).
type Cache struct {
	ttl        time.Duration
	mu         sync.Mutex
	mem        map[string]entry
	persistent PersistentStore
}

func New(ttl time.Duration, persistent PersistentStore) *Cache {
	return &Cache{ttl: ttl, mem: make(map[string]entry), persistent: persistent}
}

// Key derives a connection's cache identity (driver + DSN) without ever exposing the
// plaintext DSN.
func Key(driverName, dsn string) string {
	sum := sha256.Sum256([]byte(driverName + "|" + dsn))
	return hex.EncodeToString(sum[:])
}

// Get returns the cached catalog (memory, falling back to the persistent layer) and
// whether it was valid (found and not expired).
func (c *Cache) Get(cacheKey string) (Catalog, bool) {
	c.mu.Lock()
	if e, ok := c.mem[cacheKey]; ok {
		c.mu.Unlock()
		if time.Now().Before(e.expiresAt) {
			return e.catalog, true
		}
		return Catalog{}, false
	}
	c.mu.Unlock()

	if c.persistent == nil {
		return Catalog{}, false
	}
	raw, found, err := c.persistent.GetSchemaCacheJSON(cacheKey)
	if err != nil || !found {
		return Catalog{}, false
	}

	var catalog Catalog
	if err := json.Unmarshal([]byte(raw), &catalog); err != nil {
		return Catalog{}, false
	}

	c.mu.Lock()
	c.mem[cacheKey] = entry{catalog: catalog, expiresAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()
	return catalog, true
}

// Set writes the catalog to both layers (persistence is best-effort: an error there does
// not prevent the in-memory cache from working in this session).
func (c *Cache) Set(cacheKey string, catalog Catalog) error {
	c.mu.Lock()
	c.mem[cacheKey] = entry{catalog: catalog, expiresAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()

	if c.persistent == nil {
		return nil
	}
	raw, err := json.Marshal(catalog)
	if err != nil {
		return fmt.Errorf("serializando catálogo: %w", err)
	}
	return c.persistent.SetSchemaCacheJSON(cacheKey, string(raw), c.ttl)
}

// Invalidate removes a connection's cached catalog from both layers — used for manual
// refresh and when DDL is detected in the tab itself.
func (c *Cache) Invalidate(cacheKey string) {
	c.mu.Lock()
	delete(c.mem, cacheKey)
	c.mu.Unlock()

	if c.persistent != nil {
		_ = c.persistent.DeleteSchemaCacheJSON(cacheKey)
	}
}
