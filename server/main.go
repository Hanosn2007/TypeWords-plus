package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
	_ "modernc.org/sqlite"
)

const (
	sessionLifetime = 30 * 24 * time.Hour
	maxRequestBytes = 32 << 20
)

var allowedSyncTypes = map[string]bool{
	"dict":             true,
	"setting":          true,
	"practice_word":    true,
	"practice_article": true,
}

type server struct {
	db                *sql.DB
	allowRegistration bool
}

type apiResponse struct {
	Success bool        `json:"success"`
	Code    int         `json:"code"`
	Message string      `json:"msg,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

type credentials struct {
	Email    string `json:"email"`
	Account  string `json:"account"`
	Password string `json:"password"`
}

type userView struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
}

type authView struct {
	Token string   `json:"token"`
	User  userView `json:"user"`
}

type syncRow struct {
	Type        string          `json:"type"`
	Data        json.RawMessage `json:"data"`
	UpdatedAt   string          `json:"updated_at,omitempty"`
	DataVersion *int            `json:"data_version,omitempty"`
	Revision    int64           `json:"revision,omitempty"`
}

func main() {
	dataDir := envOr("TYPEWORDS_DATA_DIR", "./data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("sqlite", filepath.Join(dataDir, "typewords.db")+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		log.Fatal(err)
	}

	s := &server{
		db:                db,
		allowRegistration: envBool("ALLOW_REGISTRATION", true),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("GET /api/auth/me", s.withUser(s.me))
	mux.HandleFunc("POST /api/auth/logout", s.withUser(s.logout))
	mux.HandleFunc("GET /api/sync/meta", s.withUser(s.syncMeta))
	mux.HandleFunc("GET /api/sync/data", s.withUser(s.syncData))
	mux.HandleFunc("PUT /api/sync/data", s.withUser(s.syncUpsert))

	addr := envOr("TYPEWORDS_LISTEN", "127.0.0.1:8080")
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("TypeWords sync API listening on %s", addr)
	log.Fatal(httpServer.ListenAndServe())
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL COLLATE NOCASE UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions (
			token_hash TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
		CREATE TABLE IF NOT EXISTS sync_items (
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			data TEXT NOT NULL,
			data_version INTEGER,
			updated_at TEXT NOT NULL,
			revision INTEGER NOT NULL DEFAULT 1,
			PRIMARY KEY (user_id, type)
		);
	`)
	return err
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Code: http.StatusOK, Data: map[string]string{"status": "ok"}})
}

func (s *server) register(w http.ResponseWriter, r *http.Request) {
	if !s.allowRegistration {
		writeError(w, http.StatusForbidden, "registration is disabled")
		return
	}

	cred, ok := parseCredentials(w, r)
	if !ok {
		return
	}

	passwordHash, err := hashPassword(cred.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to create account")
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`INSERT INTO users(email, password_hash, created_at) VALUES (?, ?, ?)`, cred.Email, passwordHash, now)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeError(w, http.StatusConflict, "email already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "unable to create account")
		return
	}
	userID, _ := result.LastInsertId()
	s.finishAuth(w, userID, cred.Email)
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	cred, ok := parseCredentials(w, r)
	if !ok {
		return
	}

	var userID int64
	var email, passwordHash string
	err := s.db.QueryRow(`SELECT id, email, password_hash FROM users WHERE email = ?`, cred.Email).Scan(&userID, &email, &passwordHash)
	if err != nil || !verifyPassword(cred.Password, passwordHash) {
		writeError(w, http.StatusUnauthorized, "email or password is incorrect")
		return
	}
	s.finishAuth(w, userID, email)
}

func (s *server) finishAuth(w http.ResponseWriter, userID int64, email string) {
	token, tokenHash, err := newSessionToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to create session")
		return
	}
	now := time.Now().UTC()
	_, err = s.db.Exec(
		`INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		tokenHash,
		userID,
		now.Add(sessionLifetime).Format(time.RFC3339Nano),
		now.Format(time.RFC3339Nano),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to create session")
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{
		Success: true,
		Code:    http.StatusOK,
		Data: authView{
			Token: token,
			User:  userView{ID: userID, Email: email},
		},
	})
}

func (s *server) me(w http.ResponseWriter, _ *http.Request, user userView, _ string) {
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Code: http.StatusOK, Data: user})
}

func (s *server) logout(w http.ResponseWriter, _ *http.Request, _ userView, tokenHash string) {
	_, _ = s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Code: http.StatusOK, Data: true})
}

func (s *server) syncMeta(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	types, ok := requestedTypes(w, r)
	if !ok {
		return
	}
	rows, err := s.querySyncRows(user.ID, types, false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to load sync metadata")
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Code: http.StatusOK, Data: rows})
}

func (s *server) syncData(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	types, ok := requestedTypes(w, r)
	if !ok {
		return
	}
	rows, err := s.querySyncRows(user.ID, types, true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to load sync data")
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Code: http.StatusOK, Data: rows})
}

func (s *server) querySyncRows(userID int64, types []string, includeData bool) ([]syncRow, error) {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(types)), ",")
	columns := "type, updated_at, data_version, revision"
	if includeData {
		columns += ", data"
	}
	args := make([]interface{}, 0, len(types)+1)
	args = append(args, userID)
	for _, itemType := range types {
		args = append(args, itemType)
	}
	rows, err := s.db.Query(
		`SELECT `+columns+` FROM sync_items WHERE user_id = ? AND type IN (`+placeholders+`) ORDER BY type`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]syncRow, 0, len(types))
	for rows.Next() {
		var row syncRow
		var dataVersion sql.NullInt64
		var rawData string
		if includeData {
			err = rows.Scan(&row.Type, &row.UpdatedAt, &dataVersion, &row.Revision, &rawData)
			row.Data = json.RawMessage(rawData)
		} else {
			err = rows.Scan(&row.Type, &row.UpdatedAt, &dataVersion, &row.Revision)
		}
		if err != nil {
			return nil, err
		}
		if dataVersion.Valid {
			v := int(dataVersion.Int64)
			row.DataVersion = &v
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *server) syncUpsert(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	var payload struct {
		Rows []syncRow `json:"rows"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid sync payload")
		return
	}
	if len(payload.Rows) == 0 || len(payload.Rows) > len(allowedSyncTypes) {
		writeError(w, http.StatusBadRequest, "invalid sync rows")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to save sync data")
		return
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	seen := make(map[string]bool, len(payload.Rows))
	for _, row := range payload.Rows {
		if !allowedSyncTypes[row.Type] || seen[row.Type] || !json.Valid(row.Data) {
			writeError(w, http.StatusBadRequest, "invalid sync row")
			return
		}
		seen[row.Type] = true
		var dataVersion interface{}
		if row.DataVersion != nil {
			dataVersion = *row.DataVersion
		}
		_, err = tx.Exec(`
			INSERT INTO sync_items(user_id, type, data, data_version, updated_at, revision)
			VALUES (?, ?, ?, ?, ?, 1)
			ON CONFLICT(user_id, type) DO UPDATE SET
				data = excluded.data,
				data_version = excluded.data_version,
				updated_at = excluded.updated_at,
				revision = sync_items.revision + 1
		`, user.ID, row.Type, string(row.Data), dataVersion, now)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "unable to save sync data")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "unable to save sync data")
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Code: http.StatusOK, Data: true})
}

func (s *server) withUser(next func(http.ResponseWriter, *http.Request, userView, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(auth, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		tokenHash := hashToken(token)
		var user userView
		var expiresAt string
		err := s.db.QueryRow(`
			SELECT users.id, users.email, sessions.expires_at
			FROM sessions
			JOIN users ON users.id = sessions.user_id
			WHERE sessions.token_hash = ?
		`, tokenHash).Scan(&user.ID, &user.Email, &expiresAt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid session")
			return
		}
		expires, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil || time.Now().UTC().After(expires) {
			_, _ = s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
			writeError(w, http.StatusUnauthorized, "session expired")
			return
		}
		next(w, r, user, tokenHash)
	}
}

func parseCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var cred credentials
	if err := json.NewDecoder(r.Body).Decode(&cred); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return credentials{}, false
	}
	if cred.Email == "" {
		cred.Email = cred.Account
	}
	cred.Email = strings.ToLower(strings.TrimSpace(cred.Email))
	if !validEmail(cred.Email) {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return credentials{}, false
	}
	if len(cred.Password) < 8 || len(cred.Password) > 128 {
		writeError(w, http.StatusBadRequest, "password must be 8-128 characters")
		return credentials{}, false
	}
	return cred, true
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && strings.EqualFold(address.Address, value) && len(value) <= 254
}

func requestedTypes(w http.ResponseWriter, r *http.Request) ([]string, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("types"))
	if raw == "" {
		writeError(w, http.StatusBadRequest, "sync types are required")
		return nil, false
	}
	seen := make(map[string]bool)
	types := make([]string, 0, len(allowedSyncTypes))
	for _, itemType := range strings.Split(raw, ",") {
		itemType = strings.TrimSpace(itemType)
		if !allowedSyncTypes[itemType] {
			writeError(w, http.StatusBadRequest, "invalid sync type")
			return nil, false
		}
		if !seen[itemType] {
			seen[itemType] = true
			types = append(types, itemType)
		}
	}
	return types, true
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, 1, 64*1024, 2, 32)
	return base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 2 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 1, 64*1024, 2, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func newSessionToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, apiResponse{Success: false, Code: status, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, payload apiResponse) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		log.Printf("invalid %s value %q, using %t", key, value, fallback)
		return fallback
	}
	return parsed
}
