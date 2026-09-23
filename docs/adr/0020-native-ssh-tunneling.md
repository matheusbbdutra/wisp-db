# ADR 0020 — Native SSH Tunneling via `crypto/ssh`

**Status:** Accepted  
**Date:** 2026-09-22  

## Context

Many production and staging database instances (AWS RDS, GCP Cloud SQL, internal VPS) are hosted on private subnets and can only be accessed through an intermediate SSH bastion / jump host.
Without native SSH tunneling in Wisp, users must manually configure an external SSH tunnel in their terminal (`ssh -L 5433:db:5432 user@bastion`) before connecting.
`docs/ARCHITECTURE.md` defines SSH tunneling via pure Go `golang.org/x/crypto/ssh` as the intended solution (avoiding external OS binaries or OpenSSH dependencies).

## Decision

Implement native SSH tunneling in Go using `golang.org/x/crypto/ssh` with support for passwords, private keys (with or without passphrase), and the local SSH agent.

### 1. SSH Configuration Model (`internal/sshtunnel/`)

Create `internal/sshtunnel/tunnel.go`:

```go
type SSHConfig struct {
    Enabled        bool   `json:"enabled"`
    Host           string `json:"host"`
    Port           int    `json:"port"`           // Default: 22
    User           string `json:"user"`
    AuthMethod     string `json:"authMethod"`     // "password", "key_file", "agent"
    Password       string `json:"password,omitempty"`
    KeyPath        string `json:"keyPath,omitempty"`
    KeyPassphrase  string `json:"keyPassphrase,omitempty"`
}

type Tunnel struct {
    client *ssh.Client
}

func OpenTunnel(cfg SSHConfig) (*Tunnel, error)
func (t *Tunnel) Dial(network, addr string) (net.Conn, error)
func (t *Tunnel) Close() error
```

### 2. Driver Integration

Wire the tunnel's custom `Dial` function into the database driver connections:

1. **PostgreSQL (`pgx` / `pgxpool`)**:
   - Set `pgx.ConnConfig.DialFunc = tunnel.Dial`.
   - The TCP handshake and TLS negotiation proceed transparently through the SSH channel.
2. **MySQL / MariaDB (`go-sql-driver/mysql`)**:
   - Register a custom network dialect with `mysql.RegisterDialContext`:
     ```go
     netName := fmt.Sprintf("ssh+%s", tabID)
     mysql.RegisterDialContext(netName, func(ctx context.Context, addr string) (net.Conn, error) {
         return tunnel.Dial("tcp", addr)
     })
     ```
   - Connect using DSN format `user:pass@ssh+tabID(remoteHost:remotePort)/dbname`.
3. **SQLite**:
   - Local database; SSH tunneling is not applicable and disabled in UI.

### 3. Encrypted Storage (`internal/store/`)

- Store `SSHConfig` within `SavedConnection`'s `encrypted_secret` (encrypted with ChaCha20-Poly1305 via `internal/vault`).
- SSH passwords and private key passphrases are never stored in plaintext on disk.

### 4. Frontend Integration (`ConnectionModal.tsx`)

Add an "SSH Tunnel" toggle and configuration panel inside `ConnectionModal.tsx`:
- Checkbox: "Usar túnel SSH (Bastion / Jump Host)".
- Fields: SSH Host, Port (default 22), Username.
- Auth Type Selector:
  - "Chave privada (arquivo)" with file picker button (`.pem`, `id_rsa`, `id_ed25519`) and optional passphrase.
  - "Senha".
  - "SSH Agent" (connects to `$SSH_AUTH_SOCK` on Linux/macOS or Named Pipe on Windows).
- "Testar conexão" tests both the SSH handshake and the database connection sequentially.

## Consequences

- **Pros**:
  - Unlocks connectivity to private cloud databases without requiring third-party terminal tunnels.
  - Zero external binary dependency (pure Go `crypto/ssh`).
  - Secure credential storage inside existing OS keychain vault.
- **Cons**:
  - Adds connection setup latency (~100-300ms) for the SSH handshake.

## Acceptance Criteria

1. Connecting to PostgreSQL or MySQL through an SSH jump host succeeds using private key authentication.
2. Invalid SSH credentials or unreachable SSH host returns a clear, human-readable error before attempting the database connection.
3. Closing the tab or disconnecting terminates the underlying SSH client and frees the socket.
