package db

import "fmt"

// DriverName identifies the supported dialect. This is the only place in the code that
// selects by database type — no other module should have switches scattered by dialect
// (see CLAUDE.md, "Convenções de código").
type DriverName string

const (
	DriverSQLite   DriverName = "sqlite"
	DriverPostgres DriverName = "postgres"
)

// New returns a new (disconnected) instance of the requested driver.
func New(name DriverName) (DatabaseDriver, error) {
	switch name {
	case DriverSQLite:
		return NewSQLiteDriver(), nil
	case DriverPostgres:
		return NewPostgresDriver(), nil
	default:
		return nil, fmt.Errorf("driver não suportado: %q", name)
	}
}
