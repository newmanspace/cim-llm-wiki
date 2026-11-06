package config

import (
	"strings"
	"testing"
)

func TestEnvironmentConfiguration(t *testing.T) {
	t.Setenv("AUTH_PASSWORD_SHA256", "")
	t.Setenv("AUTH_PASSWORD_HASH", "bcrypt-hash-from-secret-store")
	t.Setenv("AUTH_ENABLED", "false")
	cfg := Load()
	if cfg.Auth.Enabled || cfg.Auth.PasswordHash != "bcrypt-hash-from-secret-store" {
		t.Fatal("auth configuration did not load")
	}
	t.Setenv("QUALITY_CONFIG_NUMBER", "42")
	if getEnvInt("QUALITY_CONFIG_NUMBER", 3) != 42 {
		t.Fatal("configured integer ignored")
	}
	t.Setenv("QUALITY_CONFIG_NUMBER", "invalid")
	if getEnvInt("QUALITY_CONFIG_NUMBER", 3) != 3 {
		t.Fatal("invalid integer did not fall back")
	}
	t.Setenv("QUALITY_CONFIG_NUMBER", "")
	if getEnvInt("QUALITY_CONFIG_NUMBER", 3) != 3 {
		t.Fatal("missing integer did not fall back")
	}
}

func TestWeakLegacyPasswordConfigurationRejected(t *testing.T) {
	t.Setenv("AUTH_PASSWORD_SHA256", "obsolete-digest")
	defer func() {
		if recover() == nil {
			t.Fatal("weak legacy credential must fail startup explicitly")
		}
	}()
	Load()
}

func TestSessionConfigurationFailsClosed(t *testing.T) {
	for _, secret := range []string{"", "short", "dev-insecure-change-me-session-secret"} {
		if err := (AuthConfig{Enabled: true, SessionSecret: secret}).Validate(); err == nil {
			t.Fatal("unsafe session secret accepted")
		}
	}
	if err := (AuthConfig{Enabled: true, SessionSecret: strings.Repeat("test", 16)}).Validate(); err != nil {
		t.Fatal(err)
	}
	if err := (AuthConfig{Enabled: false}).Validate(); err != nil {
		t.Fatal("disabled authentication should remain explicit opt-out")
	}
}
