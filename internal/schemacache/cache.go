// Package schemacache implementa o cache de metadados de schema em duas
// camadas descrito em docs/ARCHITECTURE.md ("Fluxo de metadados"): memória
// (rápido, vive enquanto a conexão está ativa) + persistência opcional
// (sobrevive entre sessões). TTL configurável, invalidação manual e
// invalidação por DDL detectado (ver App.Execute em app.go).
//
// A identidade de uma conexão para fins de cache nunca é a DSN em texto
// puro (que contém credenciais) — é um hash SHA-256 de "driver|dsn" (ver Key).
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

// Catalog é o conteúdo cacheado para uma conexão: a lista de schemas e,
// para os schemas já expandidos na sidebar, a lista de tabelas.
type Catalog struct {
	Schemas []string              `json:"schemas"`
	Tables  map[string][]db.Table `json:"tables"`
}

// PersistentStore é o contrato mínimo que internal/store.Store satisfaz
// (satisfação estrutural, sem import direto — evita acoplar este pacote ao
// schema SQLite completo do store).
type PersistentStore interface {
	GetSchemaCacheJSON(cacheKey string) (catalogJSON string, found bool, err error)
	SetSchemaCacheJSON(cacheKey string, catalogJSON string, ttl time.Duration) error
	DeleteSchemaCacheJSON(cacheKey string) error
}

type entry struct {
	catalog   Catalog
	expiresAt time.Time
}

// Cache combina a camada em memória com uma camada persistente opcional
// (persistent pode ser nil — o cache então só vive em memória, ainda válido
// dentro da mesma execução do app).
type Cache struct {
	ttl        time.Duration
	mu         sync.Mutex
	mem        map[string]entry
	persistent PersistentStore
}

func New(ttl time.Duration, persistent PersistentStore) *Cache {
	return &Cache{ttl: ttl, mem: make(map[string]entry), persistent: persistent}
}

// Key deriva a identidade de cache de uma conexão (driver + DSN) sem nunca
// expor a DSN em texto puro.
func Key(driverName, dsn string) string {
	sum := sha256.Sum256([]byte(driverName + "|" + dsn))
	return hex.EncodeToString(sum[:])
}

// Get retorna o catálogo cacheado (memória, com fallback pra camada
// persistente) e se estava válido (encontrado e não expirado).
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

// Set grava o catálogo nas duas camadas (persistente é melhor-esforço: erro
// ali não impede o cache em memória de funcionar nesta sessão).
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

// Invalidate remove o catálogo cacheado de uma conexão nas duas camadas —
// usado em refresh manual e quando DDL é detectado na própria aba.
func (c *Cache) Invalidate(cacheKey string) {
	c.mu.Lock()
	delete(c.mem, cacheKey)
	c.mu.Unlock()

	if c.persistent != nil {
		_ = c.persistent.DeleteSchemaCacheJSON(cacheKey)
	}
}
