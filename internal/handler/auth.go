package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"cim-llm-wiki/internal/config"
)

// AuthHandler implements the gateway session login used to protect the wiki and
// admin browsing surfaces. Sessions are stateless: an HMAC-signed, HttpOnly
// cookie carries "username|expiry" and is validated on every auth_request from
// nginx. Credentials come from the environment until a user store is wired in
// (see Authenticator).
type AuthHandler struct {
	cfg config.AuthConfig
}

func NewAuthHandler(cfg config.AuthConfig) *AuthHandler {
	return &AuthHandler{cfg: cfg}
}

// loginRequest is the JSON body accepted by Login.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// authenticate verifies the submitted credentials against the static env-backed
// credential. This is the seam: swap this (or the whole Authenticator) for a
// Postgres/LDAP-backed check without touching the session logic.
func (h *AuthHandler) authenticate(username, password string) bool {
	if subtle.ConstantTimeCompare([]byte(username), []byte(h.cfg.Username)) != 1 {
		return false
	}
	switch {
	case h.cfg.PasswordHash != "":
		return bcrypt.CompareHashAndPassword([]byte(h.cfg.PasswordHash), []byte(password)) == nil
	case h.cfg.Password != "":
		return subtle.ConstantTimeCompare([]byte(password), []byte(h.cfg.Password)) == 1
	default:
		// No password configured → refuse rather than open the door.
		return false
	}
}

// Login POST /api/v1/auth/login — validate credentials and issue a session cookie.
func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if !h.authenticate(req.Username, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}
	h.setSession(c, req.Username)
	c.JSON(http.StatusOK, gin.H{"ok": true, "user": req.Username})
}

// Logout POST /api/v1/auth/logout — clear the session cookie.
func (h *AuthHandler) Logout(c *gin.Context) {
	h.clearSession(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Verify GET /api/v1/auth/verify — the nginx auth_request target. 2xx → allow,
// 401 → deny. When auth is disabled it always allows so the gate stays
// transparent and nobody is locked out.
func (h *AuthHandler) Verify(c *gin.Context) {
	if !h.cfg.Enabled {
		c.Header("X-Auth-User", "anonymous")
		c.JSON(http.StatusOK, gin.H{"authenticated": true, "user": "anonymous"})
		return
	}
	cookie, err := c.Cookie(h.cfg.CookieName)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"authenticated": false, "error": "missing session"})
		return
	}
	user, ok := h.parseSession(cookie)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"authenticated": false, "error": "invalid or expired session"})
		return
	}
	c.Header("X-Auth-User", user)
	c.JSON(http.StatusOK, gin.H{"authenticated": true, "user": user})
}

// ─── session codec ────────────────────────────────────────────────────────────

// signSession builds "<base64url(user|exp)>.<hexHMAC>".
func (h *AuthHandler) signSession(username string) string {
	exp := time.Now().Add(time.Duration(h.cfg.SessionTTLHours) * time.Hour).Unix()
	payload := username + "|" + strconv.FormatInt(exp, 10)
	enc := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return enc + "." + h.hmacHex([]byte(payload))
}

// parseSession validates the cookie and returns the username when intact and
// not expired.
func (h *AuthHandler) parseSession(token string) (string, bool) {
	dot := strings.LastIndex(token, ".")
	if dot <= 0 || dot == len(token)-1 {
		return "", false
	}
	enc, sig := token[:dot], token[dot+1:]
	payloadBytes, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return "", false
	}
	payload := string(payloadBytes)
	if !hmac.Equal([]byte(sig), []byte(h.hmacHex(payloadBytes))) {
		return "", false
	}
	pipe := strings.LastIndex(payload, "|")
	if pipe <= 0 {
		return "", false
	}
	user, expStr := payload[:pipe], payload[pipe+1:]
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", false
	}
	return user, true
}

func (h *AuthHandler) hmacHex(msg []byte) string {
	mac := hmac.New(sha256.New, []byte(h.cfg.SessionSecret))
	mac.Write(msg)
	return hex.EncodeToString(mac.Sum(nil))
}

// ─── cookie helpers ───────────────────────────────────────────────────────────

func (h *AuthHandler) setSession(c *gin.Context, username string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     h.cfg.CookieName,
		Value:    h.signSession(username),
		Path:     "/",
		MaxAge:   h.cfg.SessionTTLHours * 3600,
		HttpOnly: true,
		Secure:   h.cfg.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearSession(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     h.cfg.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.cfg.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// RequireSession protects administrative document configuration, including direct requests.
func (h *AuthHandler) RequireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.cfg.Enabled {
			c.AbortWithStatusJSON(403, gin.H{"error": "Administrative sessions must be enabled"})
			return
		}
		if c.Request.Method != http.MethodGet && !strings.HasPrefix(c.GetHeader("Content-Type"), "application/json") {
			c.AbortWithStatusJSON(415, gin.H{"error": "Administrative writes require application/json"})
			return
		}
		cookie, err := c.Cookie(h.cfg.CookieName)
		user, valid := h.parseSession(cookie)
		if err != nil || !valid {
			c.AbortWithStatusJSON(401, gin.H{"error": "Valid administrator session required"})
			return
		}
		c.Set("quality_actor", user)
		c.Next()
	}
}
