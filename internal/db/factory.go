package db

import "fmt"

// DriverName identifica o dialeto suportado. Este é o único ponto do código
// que faz seleção por tipo de banco — nenhum outro módulo deve ter switch
// espalhado por dialeto (ver CLAUDE.md, "Convenções de código").
type DriverName string

const (
	DriverSQLite   DriverName = "sqlite"
	DriverPostgres DriverName = "postgres"
)

// New retorna uma nova instância (não conectada) do driver solicitado.
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
