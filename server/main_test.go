package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func newTestServer(t *testing.T) (*server, *http.ServeMux) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	s := &server{db: db, allowRegistration: true}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("GET /api/auth/me", s.withUser(s.me))
	mux.HandleFunc("GET /api/sync/meta", s.withUser(s.syncMeta))
	mux.HandleFunc("GET /api/sync/data", s.withUser(s.syncData))
	mux.HandleFunc("PUT /api/sync/data", s.withUser(s.syncUpsert))
	return s, mux
}

func requestJSON(t *testing.T, handler http.Handler, method, path, token string, payload interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	if payload != nil {
		if err := json.NewEncoder(&body).Encode(payload); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &body)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeResponse[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.Success {
		t.Fatalf("request failed: %s", rec.Body.String())
	}
	var result T
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func registerTestUser(t *testing.T, handler http.Handler, email string) authView {
	t.Helper()
	rec := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]string{
		"email":    email,
		"password": "test-password",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("register status = %d: %s", rec.Code, rec.Body.String())
	}
	return decodeResponse[authView](t, rec)
}

func TestRegisterLoginAndMe(t *testing.T) {
	_, mux := newTestServer(t)

	invalid := requestJSON(t, mux, http.MethodPost, "/api/auth/register", "", map[string]string{
		"email":    "invalid",
		"password": "test-password",
	})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid email status = %d", invalid.Code)
	}

	auth := registerTestUser(t, mux, "user@example.com")
	me := requestJSON(t, mux, http.MethodGet, "/api/auth/me", auth.Token, nil)
	user := decodeResponse[userView](t, me)
	if user.Email != "user@example.com" {
		t.Fatalf("email = %q", user.Email)
	}

	wrongPassword := requestJSON(t, mux, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email":    "user@example.com",
		"password": "wrong-password",
	})
	if wrongPassword.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password status = %d", wrongPassword.Code)
	}

	login := requestJSON(t, mux, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email":    "USER@example.com",
		"password": "test-password",
	})
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d: %s", login.Code, login.Body.String())
	}
}

func TestSyncDataIsIsolatedByUser(t *testing.T) {
	_, mux := newTestServer(t)
	first := registerTestUser(t, mux, "first@example.com")
	second := registerTestUser(t, mux, "second@example.com")

	upsert := requestJSON(t, mux, http.MethodPut, "/api/sync/data", first.Token, map[string]interface{}{
		"rows": []map[string]interface{}{
			{
				"type":         "dict",
				"data":         map[string]interface{}{"name": "first-user"},
				"data_version": 4,
			},
		},
	})
	if upsert.Code != http.StatusOK {
		t.Fatalf("upsert status = %d: %s", upsert.Code, upsert.Body.String())
	}

	firstData := requestJSON(t, mux, http.MethodGet, "/api/sync/data?types=dict", first.Token, nil)
	rows := decodeResponse[[]syncRow](t, firstData)
	if len(rows) != 1 || string(rows[0].Data) != `{"name":"first-user"}` {
		t.Fatalf("unexpected first user rows: %+v", rows)
	}

	secondData := requestJSON(t, mux, http.MethodGet, "/api/sync/data?types=dict", second.Token, nil)
	secondRows := decodeResponse[[]syncRow](t, secondData)
	if len(secondRows) != 0 {
		t.Fatalf("second user received first user data: %+v", secondRows)
	}
}
