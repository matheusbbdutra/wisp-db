package main

import (
	"context"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"wisp/internal/db"
	"wisp/internal/schemacache"
	"wisp/internal/session"
	"wisp/internal/sshtunnel"
	"wisp/internal/store"
)

// SessionMetadata exposes connection dialect and server version information to the frontend.
type SessionMetadata struct {
	TabID         string `json:"tabId"`
	Driver        string `json:"driver"`        // "postgres", "sqlite", "mysql", "mariadb"
	Dialect       string `json:"dialect"`       // "postgres", "sqlite", "mysql"
	ServerVersion string `json:"serverVersion"` // e.g. "PostgreSQL 16.1", "MySQL 8.4.0", "SQLite 3.45.1"
}

// Connect opens a dedicated connection for tab tabId using the driverName dialect
// ("sqlite", "postgres", "mysql", "mariadb") and the supplied dsn. Any previous connection
// for the same tab is closed (see session.Manager.Open). Returns session metadata.
func (a *App) Connect(tabID string, driverName string, dsn string) (*SessionMetadata, error) {
	return a.connect(tabID, driverName, dsn, "")
}

// ConnectWithSSH opens a dedicated tab connection with optional SSH tunnel configuration.
func (a *App) ConnectWithSSH(tabID string, driverName string, dsn string, sshCfg sshtunnel.SSHConfig) (*SessionMetadata, error) {
	var tunnel *sshtunnel.Tunnel
	if sshCfg.Enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		t, err := sshtunnel.OpenTunnel(ctx, sshCfg)
		if err != nil {
			return nil, fmt.Errorf("falha ao estabelecer túnel SSH: %w", err)
		}
		tunnel = t
	}
	return a.connectWithTunnel(tabID, driverName, dsn, "", tunnel)
}

// connect is the shared core of Connect (direct DSN) and ConnectSaved (saved connection)
// — an empty connectionID means "no associated saved connection" and makes RecordQuery
// skip writing history (see internal/store.RecordQuery).
func (a *App) connect(tabID string, driverName string, dsn string, connectionID string) (*SessionMetadata, error) {
	return a.connectWithTunnel(tabID, driverName, dsn, connectionID, nil)
}

func (a *App) connectWithTunnel(tabID string, driverName string, dsn string, connectionID string, tunnel *sshtunnel.Tunnel) (*SessionMetadata, error) {
	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, err
	}
	metadataDriver, err := db.New(db.DriverName(driverName))
	if err != nil {
		_ = driver.Close()
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, err
	}

	if tunnel != nil {
		if td, ok := driver.(db.TunneledDriver); ok {
			td.SetDialer(tunnel.DialContext)
		}
		if td, ok := metadataDriver.(db.TunneledDriver); ok {
			td.SetDialer(tunnel.DialContext)
		}
	}

	dialect := session.DialectForDriver(driverName)
	meta := session.SessionMetadata{
		TabID:   tabID,
		Driver:  driverName,
		Dialect: dialect,
	}

	ctx, err := a.sessions.Open(tabID, driver, metadataDriver, schemacache.Key(driverName, dsn), connectionID, meta)
	if err != nil {
		_ = driver.Close()
		_ = metadataDriver.Close()
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, err
	}
	if tunnel != nil {
		a.sessions.SetTunnel(tabID, tunnel)
	}

	if err := driver.Connect(ctx, dsn); err != nil {
		_ = a.sessions.Close(tabID)
		return nil, fmt.Errorf("conectando (tabId=%s): %w", tabID, err)
	}
	if err := metadataDriver.Connect(ctx, dsn); err != nil {
		_ = a.sessions.Close(tabID)
		return nil, fmt.Errorf("conectando conexão de metadados (tabId=%s): %w", tabID, err)
	}

	// Query server version using metadata connection to avoid disturbing the main streaming cursor.
	var versionQuery string
	if dialect == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	} else {
		versionQuery = "SELECT version()"
	}
	res, qErr := metadataDriver.Execute(ctx, versionQuery)
	if qErr == nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		meta.ServerVersion = fmt.Sprint(res.Rows[0][0])
		_ = a.sessions.SetMetadata(tabID, meta)
	}

	return &SessionMetadata{
		TabID:         meta.TabID,
		Driver:        meta.Driver,
		Dialect:       meta.Dialect,
		ServerVersion: meta.ServerVersion,
	}, nil
}

// Disconnect closes and removes the session for tab tabId.
func (a *App) Disconnect(tabID string) error {
	return a.sessions.Close(tabID)
}

// SaveConnection encrypts and persists a connection for future reuse (friendly name +
// driver + full DSN). It never writes the DSN in plaintext (see internal/vault).
func (a *App) SaveConnection(name string, driverName string, dsn string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveConnection(name, driverName, dsn)
}

// SaveConnectionWithSSH encrypts and persists a connection with optional SSH tunnel configuration.
func (a *App) SaveConnectionWithSSH(name string, driverName string, dsn string, sshCfg sshtunnel.SSHConfig) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store local indisponível")
	}
	return a.store.SaveConnectionWithSSH(name, driverName, dsn, &sshCfg)
}

// ListSavedConnections returns saved connections without exposing the DSN/secret.
func (a *App) ListSavedConnections() ([]store.SavedConnection, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	return a.store.ListConnections()
}

// ConnectSaved decrypts a saved connection's DSN (and optional SSH config) and uses it to open
// the session for tab tabId — the decrypted DSN is never returned to the frontend. Returns session metadata.
func (a *App) ConnectSaved(tabID string, connectionID string) (*SessionMetadata, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store local indisponível")
	}
	driverName, dsn, sshCfg, err := a.store.ResolveConnectionWithSSH(connectionID)
	if err != nil {
		return nil, err
	}

	var tunnel *sshtunnel.Tunnel
	if sshCfg != nil && sshCfg.Enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		t, err := sshtunnel.OpenTunnel(ctx, *sshCfg)
		if err != nil {
			return nil, fmt.Errorf("falha ao estabelecer túnel SSH: %w", err)
		}
		tunnel = t
	}

	return a.connectWithTunnel(tabID, driverName, dsn, connectionID, tunnel)
}

// GetSessionDialect returns the dialect name ("postgres", "sqlite", "mysql") for tab tabID.
func (a *App) GetSessionDialect(tabID string) (string, error) {
	meta, err := a.sessions.GetMetadata(tabID)
	if err != nil {
		return "", err
	}
	return meta.Dialect, nil
}

// GetSessionMetadata returns the full session metadata for tab tabID.
func (a *App) GetSessionMetadata(tabID string) (*SessionMetadata, error) {
	meta, err := a.sessions.GetMetadata(tabID)
	if err != nil {
		return nil, err
	}
	return &SessionMetadata{
		TabID:         meta.TabID,
		Driver:        meta.Driver,
		Dialect:       meta.Dialect,
		ServerVersion: meta.ServerVersion,
	}, nil
}

// TestConnection attempts to connect and immediately closes the connection, without
// persisting anything or opening a tab session.
func (a *App) TestConnection(driverName string, dsn string) error {
	return a.TestConnectionWithSSH(driverName, dsn, sshtunnel.SSHConfig{Enabled: false})
}

// TestConnectionWithSSH tests database reachability through an optional SSH tunnel.
func (a *App) TestConnectionWithSSH(driverName string, dsn string, sshCfg sshtunnel.SSHConfig) error {
	var tunnel *sshtunnel.Tunnel
	if sshCfg.Enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		t, err := sshtunnel.OpenTunnel(ctx, sshCfg)
		if err != nil {
			return fmt.Errorf("falha ao estabelecer túnel SSH: %w", err)
		}
		defer t.Close()
		tunnel = t
	}

	driver, err := db.New(db.DriverName(driverName))
	if err != nil {
		return err
	}
	defer driver.Close()

	if tunnel != nil {
		if td, ok := driver.(db.TunneledDriver); ok {
			td.SetDialer(tunnel.DialContext)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := driver.Connect(ctx, dsn); err != nil {
		return err
	}
	return nil
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

// GetConnectionForEdit returns the driver name, decrypted DSN, and optional SSH config for a saved
// connection — used EXCLUSIVELY by the connection modal's clone flow (frontend/src/components/ConnectionModal.tsx).
func (a *App) GetConnectionForEdit(connectionID string) (store.SavedConnectionEdit, error) {
	if a.store == nil {
		return store.SavedConnectionEdit{}, fmt.Errorf("store local indisponível")
	}
	driver, dsn, sshCfg, err := a.store.ResolveConnectionWithSSH(connectionID)
	if err != nil {
		return store.SavedConnectionEdit{}, err
	}
	return store.SavedConnectionEdit{Driver: driver, DSN: dsn, SSH: sshCfg}, nil
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

// PickSSHKeyFile opens the native system dialog to select an SSH private key file.
func (a *App) PickSSHKeyFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Selecionar chave privada SSH",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Chaves SSH (*.pem;*.key;*id_*)",
				Pattern:     "*.pem;*.key;*id_rsa*;*id_ed25519*;*id_ecdsa*;*id_dsa*",
			},
			{
				DisplayName: "Todos os arquivos (*.*)",
				Pattern:     "*.*",
			},
		},
	})
}
