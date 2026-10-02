// Package config provides application configuration loaded from environment
// variables and an optional YAML/TOML config file.
package config

import (
"os"
"strconv"
"time"
)

// Config is the root configuration for cim-llm-wiki server.
type Config struct {
Server    ServerConfig
Wiki      WikiConfig
Parser    ParserConfig
LLM       LLMConfig
Evaluator EvaluatorConfig
Storage   StorageConfig
Admin     AdminConfig
Auth      AuthConfig
Qdrant    QdrantConfig
Meili     MeiliConfig
Git       GitConfig
}

// ServerConfig is the HTTP server configuration.
type ServerConfig struct {
Host            string
Port            int
ShutdownTimeout time.Duration
}

// WikiConfig defines where wiki/ output is written (runtime directory).
type WikiConfig struct {
// OutputDir is the root of the generated wiki (default: ./data/wiki).
// This directory is created at startup if it does not exist.
// It is NOT part of the source tree and should be in .gitignore.
OutputDir string
// RawDir is where uploaded raw documents are stored (default: ./data/raw).
RawDir string
}

// ParserConfig configures the document parsing engines.
type ParserConfig struct {
// MinerU self-hosted endpoint (required for PDF parsing)
MinerUEndpoint string
MinerUAPIKey   string
MinerUTimeout  time.Duration

// Docling service endpoint (required for DOCX/PPTX/HTML)
DoclingEndpoint string
DoclingTimeout  time.Duration

// OCR language list (comma-separated, e.g. "ch,en")
OCRLanguages []string
}

// LLMConfig configures the LLM used for knowledge extraction.
type LLMConfig struct {
// BaseURL is an OpenAI-compatible endpoint (e.g. http://localhost:11434/v1 for Ollama)
BaseURL string
APIKey  string
Model   string
// MaxTokens for extraction response
MaxTokens   int
Temperature float64
}

// EvaluatorConfig holds the 7-dimension quality scoring weights.
// These are POC initial values; calibrate with Golden Dataset before production.
type EvaluatorConfig struct {
WAuth   float64 // 来源可信度权重
WComp   float64 // 内容完整性权重
WRel    float64 // 产品相关性权重
WFresh  float64 // 时效性权重
WStruct float64 // 结构质量权重
WReuse  float64 // 可复用性权重
WRisk   float64 // 冲突风险权重

// Thresholds for ReviewLevel classification
ThreshL0Auto   float64 // ≥ this → auto-publish  (default 0.95)
ThreshL1Expert float64 // ≥ this → expert review  (default 0.80)
ThreshL2Arch   float64 // ≥ this → arch review    (default 0.55)
// below ThreshL2Arch → archive
}

// StorageConfig configures the SQLite database for node/bundle metadata.
type StorageConfig struct {
// DSN is the SQLite file path (default: ./data/cim-wiki.db)
DSN string
}

// AdminConfig configures the Admin system (PostgreSQL + Project Registry API).
type AdminConfig struct {
// Enabled activates the Admin API endpoints (default: false, requires PostgreSQL)
Enabled bool
// PostgresDSN is the PostgreSQL connection string
// e.g. postgres://user:pass@localhost:5432/cim_wiki_admin?sslmode=disable
PostgresDSN string
// MigrationDir is the directory containing SQL migration files
MigrationDir string
// TokenDefaultExpiryHours is the default token expiry (0 = never expires)
TokenDefaultExpiryHours int
}

// AuthConfig configures the gateway session login (wiki + admin access control).
// Mechanism only: credentials come from environment until a user store is wired.
type AuthConfig struct {
// Enabled is the master switch. When false, /api/v1/auth/verify always
// returns 200 so the nginx auth_request gate stays transparent (no lockout).
Enabled bool
// SessionSecret signs the HMAC session cookie. MUST be overridden in prod.
SessionSecret string
// CookieName is the session cookie name (default: cim_session).
CookieName string
// SessionTTLHours is cookie lifetime in hours (default: 12).
SessionTTLHours int
// Secure marks the cookie Secure (enable behind HTTPS).
Secure bool
// Username / Password are the static single-credential defaults. Password
// should be checked against PasswordSHA256 (lowercase hex of sha256(pw))
// when provided; the plaintext Password is only a dev fallback.
Username        string
Password        string
PasswordSHA256  string
}

// QdrantConfig configures the Qdrant vector store for semantic search.
type QdrantConfig struct {
Host       string
Port       int
Collection string
APIKey     string
}

// MeiliConfig configures Meilisearch for BM25 full-text search.
type MeiliConfig struct {
Host   string
APIKey string
Index  string
}

// GitConfig configures git operations for atomic wiki commits.
type GitConfig struct {
// RepoPath is the directory managed as a git repo (same as WikiConfig.OutputDir)
RepoPath   string
AuthorName string
AuthorEmail string
}

// Load returns a Config populated from environment variables with sensible defaults.
func Load() *Config {
return &Config{
Server: ServerConfig{
Host:            getEnv("SERVER_HOST", "0.0.0.0"),
Port:            getEnvInt("SERVER_PORT", 8080),
ShutdownTimeout: 30 * time.Second,
},
Wiki: WikiConfig{
OutputDir: getEnv("WIKI_OUTPUT_DIR", "./data/wiki"),
RawDir:    getEnv("WIKI_RAW_DIR", "./data/raw"),
},
Parser: ParserConfig{
MinerUEndpoint:  getEnv("MINERU_ENDPOINT", ""),
MinerUAPIKey:    getEnv("MINERU_API_KEY", ""),
MinerUTimeout:   time.Duration(getEnvInt("MINERU_TIMEOUT_SEC", 600)) * time.Second,
DoclingEndpoint: getEnv("DOCLING_ENDPOINT", ""),
DoclingTimeout:  time.Duration(getEnvInt("DOCLING_TIMEOUT_SEC", 120)) * time.Second,
OCRLanguages:    []string{"ch", "en"},
},
LLM: LLMConfig{
BaseURL:     getEnv("LLM_BASE_URL", "https://api.openai.com/v1"),
APIKey:      getEnv("LLM_API_KEY", ""),
Model:       getEnv("LLM_MODEL", "gpt-4o"),
MaxTokens:   getEnvInt("LLM_MAX_TOKENS", 4096),
Temperature: 0.1,
},
Evaluator: EvaluatorConfig{
// POC 初始权重（见方案 §4.3，需 Golden Dataset 回归校准）
WAuth:   0.20,
WComp:   0.20,
WRel:    0.15,
WFresh:  0.15,
WStruct: 0.10,
WReuse:  0.10,
WRisk:   0.10,
// 审核分级门限
ThreshL0Auto:   getEnvFloat("THRESH_L0", 0.95),
ThreshL1Expert: getEnvFloat("THRESH_L1", 0.80),
ThreshL2Arch:   getEnvFloat("THRESH_L2", 0.55),
},
Storage: StorageConfig{
DSN: getEnv("DB_DSN", "./data/cim-wiki.db"),
},
Admin: AdminConfig{
Enabled:               getEnv("ADMIN_ENABLED", "false") == "true",
PostgresDSN:           getEnv("ADMIN_DATABASE_URL", ""),
MigrationDir:          getEnv("ADMIN_MIGRATION_DIR", "./deploy/postgres"),
TokenDefaultExpiryHours: getEnvInt("ADMIN_TOKEN_EXPIRY_HOURS", 0),
},
Auth: AuthConfig{
Enabled:           getEnv("AUTH_ENABLED", "true") == "true",
SessionSecret:     getEnv("AUTH_SESSION_SECRET", "dev-insecure-change-me-session-secret"),
CookieName:        getEnv("AUTH_COOKIE_NAME", "cim_session"),
SessionTTLHours:   getEnvInt("AUTH_SESSION_TTL_HOURS", 12),
Secure:            getEnv("AUTH_COOKIE_SECURE", "false") == "true",
Username:          getEnv("AUTH_USERNAME", "admin"),
Password:          getEnv("AUTH_PASSWORD", ""),
PasswordSHA256:    getEnv("AUTH_PASSWORD_SHA256", ""),
},
Qdrant: QdrantConfig{
Host:       getEnv("QDRANT_HOST", "localhost"),
Port:       getEnvInt("QDRANT_PORT", 6333),
Collection: getEnv("QDRANT_COLLECTION", "cim_wiki"),
APIKey:     getEnv("QDRANT_API_KEY", ""),
},
Meili: MeiliConfig{
Host:   getEnv("MEILI_HOST", "http://localhost:7700"),
APIKey: getEnv("MEILI_API_KEY", ""),
Index:  getEnv("MEILI_INDEX", "cim_wiki"),
},
Git: GitConfig{
RepoPath:    getEnv("WIKI_OUTPUT_DIR", "./data/wiki"),
AuthorName:  getEnv("GIT_AUTHOR_NAME", "cim-wiki-bot"),
AuthorEmail: getEnv("GIT_AUTHOR_EMAIL", "bot@cim-wiki.local"),
},
}
}

func getEnv(key, def string) string {
if v := os.Getenv(key); v != "" {
return v
}
return def
}

func getEnvInt(key string, def int) int {
if v := os.Getenv(key); v != "" {
if i, err := strconv.Atoi(v); err == nil {
return i
}
}
return def
}

func getEnvFloat(key string, def float64) float64 {
if v := os.Getenv(key); v != "" {
if f, err := strconv.ParseFloat(v, 64); err == nil {
return f
}
}
return def
}
