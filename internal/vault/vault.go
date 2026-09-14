// Package vault implementa a cifragem de credenciais do Wisp (ADR: nunca
// texto puro em disco, ver docs/adr/0003-storage.md e CLAUDE.md). A chave
// mestra é gerada uma vez e guardada no keychain do SO via go-keyring
// (Secret Service no Linux, Keychain no macOS, Credential Manager no
// Windows) — nunca em arquivo de config ou variável de ambiente.
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

// Vault cifra/decifra segredos de conexão usando ChaCha20-Poly1305 com uma
// chave mestra persistida no keychain do SO.
type Vault struct {
	aead interface {
		Seal(dst, nonce, plaintext, additionalData []byte) []byte
		Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
		NonceSize() int
	}
}

// Open carrega a chave mestra do keychain do SO, gerando e persistindo uma
// nova na primeira execução.
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

// Encrypt cifra plaintext (ex.: senha de conexão) retornando nonce+ciphertext
// concatenados, prontos para gravar em encrypted_secret (ver internal/store).
func (v *Vault) Encrypt(plaintext string) ([]byte, error) {
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("gerando nonce: %w", err)
	}
	return v.aead.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

// Decrypt reverte Encrypt. Falha se ciphertext foi adulterado (autenticação
// do ChaCha20-Poly1305), nunca retorna dado parcial/corrompido silenciosamente.
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
