// Package vault implements Wisp credential encryption (ADR: never plaintext on disk, see
// docs/adr/0003-storage.md and CLAUDE.md). The master key is generated once and stored
// in the OS keychain via go-keyring (Secret Service on Linux, Keychain on macOS,
// Credential Manager on Windows) — never in a config file or environment variable.
package vault

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/zalando/go-keyring"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	keyringService = "wisp"
	keyringUser    = "master-key"
	keySize        = chacha20poly1305.KeySize
)

// Vault encrypts/decrypts connection secrets using ChaCha20-Poly1305 with a master key
// persisted in the OS keychain.
type Vault struct {
	aead interface {
		Seal(dst, nonce, plaintext, additionalData []byte) []byte
		Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
		NonceSize() int
	}
}

// Open loads the master key from the OS keychain, generating and persisting a new one on
// the first run.
func Open() (*Vault, error) {
	key, err := loadOrCreateMasterKey()
	if err != nil {
		return nil, fmt.Errorf("carregando chave mestra: %w", err)
	}
	aead, err := chacha20poly1305.New(key)
	if err != nil {
		return nil, fmt.Errorf("inicializando cifra: %w", err)
	}
	return &Vault{aead: aead}, nil
}

// Encrypt encrypts plaintext (e.g. a connection password), returning concatenated
// nonce+ciphertext, ready to write to encrypted_secret (see internal/store).
func (v *Vault) Encrypt(plaintext string) ([]byte, error) {
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("gerando nonce: %w", err)
	}
	return v.aead.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

// Decrypt reverses Encrypt. It fails if ciphertext has been tampered with
// (ChaCha20-Poly1305 authentication), never silently returning partial/corrupted data.
func (v *Vault) Decrypt(ciphertext []byte) (string, error) {
	nonceSize := v.aead.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext inválido: menor que o nonce")
	}
	nonce, data := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := v.aead.Open(nil, nonce, data, nil)
	if err != nil {
		return "", fmt.Errorf("decifrando segredo: %w", err)
	}
	return string(plaintext), nil
}

func loadOrCreateMasterKey() ([]byte, error) {
	hexKey, err := keyring.Get(keyringService, keyringUser)
	if err == nil {
		return hex.DecodeString(hexKey)
	}
	if err != keyring.ErrNotFound {
		return nil, fmt.Errorf("lendo keychain do SO: %w", err)
	}

	key := make([]byte, keySize)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("gerando chave mestra: %w", err)
	}
	if err := keyring.Set(keyringService, keyringUser, hex.EncodeToString(key)); err != nil {
		return nil, fmt.Errorf("gravando chave mestra no keychain do SO: %w", err)
	}
	return key, nil
}
