package sshtunnel

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// SSHConfig holds configuration parameters for establishing an SSH tunnel to a bastion host.
type SSHConfig struct {
	Enabled       bool   `json:"enabled"`
	Host          string `json:"host"`
	Port          int    `json:"port"` // Default: 22
	User          string `json:"user"`
	AuthMethod    string `json:"authMethod"` // "password", "key_file", "agent"
	Password      string `json:"password,omitempty"`
	KeyPath       string `json:"keyPath,omitempty"`
	KeyPassphrase string `json:"keyPassphrase,omitempty"`
}

// Tunnel manages an active SSH client connection to tunnel TCP traffic.
type Tunnel struct {
	client *ssh.Client
}

// OpenTunnel establishes an SSH connection to the remote bastion host.
func OpenTunnel(ctx context.Context, cfg SSHConfig) (*Tunnel, error) {
	if !cfg.Enabled {
		return nil, fmt.Errorf("túnel SSH não está habilitado")
	}
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, fmt.Errorf("host SSH não especificado")
	}
	if strings.TrimSpace(cfg.User) == "" {
		return nil, fmt.Errorf("usuário SSH não especificado")
	}

	port := cfg.Port
	if port <= 0 {
		port = 22
	}

	var authMethods []ssh.AuthMethod

	switch cfg.AuthMethod {
	case "key_file":
		if cfg.KeyPath == "" {
			return nil, fmt.Errorf("caminho da chave privada SSH não especificado")
		}
		keyBytes, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("lendo chave privada SSH (%s): %w", cfg.KeyPath, err)
		}

		var signer ssh.Signer
		if cfg.KeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cfg.KeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(keyBytes)
		}
		if err != nil {
			return nil, fmt.Errorf("decodificando chave privada SSH: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))

	case "agent":
		sock := os.Getenv("SSH_AUTH_SOCK")
		if sock == "" {
			return nil, fmt.Errorf("SSH_AUTH_SOCK não está configurado no ambiente")
		}
		conn, err := net.Dial("unix", sock)
		if err != nil {
			return nil, fmt.Errorf("conectando ao ssh-agent (%s): %w", sock, err)
		}
		agentClient := agent.NewClient(conn)
		signers, err := agentClient.Signers()
		if err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("consultando chaves no ssh-agent: %w", err)
		}
		if len(signers) == 0 {
			_ = conn.Close()
			return nil, fmt.Errorf("nenhuma chave disponível no ssh-agent")
		}
		authMethods = append(authMethods, ssh.PublicKeys(signers...))

	default: // "password"
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	}

	sshConfig := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	targetAddr := fmt.Sprintf("%s:%d", cfg.Host, port)

	// Dial with context support
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", targetAddr)
	if err != nil {
		return nil, fmt.Errorf("falha ao conectar no host SSH (%s): %w", targetAddr, err)
	}

	ncc, chans, reqs, err := ssh.NewClientConn(conn, targetAddr, sshConfig)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("handshake SSH falhou com %s: %w", targetAddr, err)
	}

	client := ssh.NewClient(ncc, chans, reqs)
	return &Tunnel{client: client}, nil
}

// Dial establishes an outbound TCP connection through the SSH tunnel to target addr.
func (t *Tunnel) Dial(network, addr string) (net.Conn, error) {
	if t.client == nil {
		return nil, fmt.Errorf("túnel SSH não está conectado")
	}
	return t.client.Dial(network, addr)
}

// DialContext establishes a connection with context timeout support through the SSH tunnel.
func (t *Tunnel) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	type dialResult struct {
		conn net.Conn
		err  error
	}
	ch := make(chan dialResult, 1)

	go func() {
		c, err := t.Dial(network, addr)
		ch <- dialResult{conn: c, err: err}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		return res.conn, res.err
	}
}

// Close terminates the SSH client connection.
func (t *Tunnel) Close() error {
	if t.client != nil {
		return t.client.Close()
	}
	return nil
}
