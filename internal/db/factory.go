package db

import "fmt"

// DriverName identifies the supported dialect. This is the only place in the code that
// selects by database type — no other module should have switches scattered by dialect
// (see AGENTS.md, "Convenções de código").
type DriverName string

const (
	DriverSQLite   DriverName = "sqlite"
	DriverPostgres DriverName = "postgres"
	DriverMySQL    DriverName = "mysql"
	DriverMariaDB  DriverName = "mariadb"
)

// New returns a new (disconnected) instance of the requested driver. MariaDB reuses the
// MySQL driver because the wire protocol is identical on the application level — see
// docs/adr/0007-mysql-mariadb-driver.md.
func New(name DriverName) (DatabaseDriver, error) {
	switch name {
	case DriverSQLite:
		return NewSQLiteDriver(), nil
	case DriverPostgres:
		return NewPostgresDriver(), nil
	case DriverMySQL, DriverMariaDB:
		return NewMySQLDriver(), nil
	default:
		return nil, fmt.Errorf("driver não suportado: %q", name)
	}
}
