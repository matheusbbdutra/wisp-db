package sshtunnel

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func startTestSSHServer(t *testing.T, expectedUser, expectedPassword string) (int, func()) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("Failed to generate test RSA key: %v", err)
	}

	hostSigner, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatalf("Failed to create signer from test key: %v", err)
	}

	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == expectedUser && string(pass) == expectedPassword {
				return nil, nil
			}
			return nil, fmt.Errorf("invalid credentials")
		},
	}
	config.AddHostKey(hostSigner)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to listen: %v", err)
	}

	done := make(chan struct{})

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-done:
					return
				default:
					return
				}
			}

			go func(c net.Conn) {
				sConn, chans, reqs, err := ssh.NewServerConn(c, config)
				if err != nil {
					_ = c.Close()
					return
				}
				defer sConn.Close()
				go ssh.DiscardRequests(reqs)
				for newChannel := range chans {
					_ = newChannel.Reject(ssh.Prohibited, "not supported in test")
				}
			}(conn)
		}
	}()

	port := listener.Addr().(*net.TCPAddr).Port
	cleanup := func() {
		close(done)
		_ = listener.Close()
	}

	return port, cleanup
}

func TestSSHTunnel(t *testing.T) {
	port, cleanup := startTestSSHServer(t, "testuser", "testpass")
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("Successful connection with password", func(t *testing.T) {
		cfg := SSHConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       port,
			User:       "testuser",
			AuthMethod: "password",
			Password:   "testpass",
		}

		tunnel, err := OpenTunnel(ctx, cfg)
		if err != nil {
			t.Fatalf("OpenTunnel failed: %v", err)
		}
		defer tunnel.Close()

		if tunnel.client == nil {
			t.Errorf("Expected tunnel client to be non-nil")
		}
	})

	t.Run("Failed authentication", func(t *testing.T) {
		cfg := SSHConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       port,
			User:       "testuser",
			AuthMethod: "password",
			Password:   "wrongpassword",
		}

		_, err := OpenTunnel(ctx, cfg)
		if err == nil {
			t.Fatalf("Expected error for wrong password, got nil")
		}
	})

	t.Run("Validation errors", func(t *testing.T) {
		_, err := OpenTunnel(ctx, SSHConfig{Enabled: false})
		if err == nil {
			t.Errorf("Expected error for disabled config")
		}

		_, err = OpenTunnel(ctx, SSHConfig{Enabled: true, Host: ""})
		if err == nil {
			t.Errorf("Expected error for empty host")
		}

		_, err = OpenTunnel(ctx, SSHConfig{Enabled: true, Host: "127.0.0.1", User: ""})
		if err == nil {
			t.Errorf("Expected error for empty user")
		}
	})
}
