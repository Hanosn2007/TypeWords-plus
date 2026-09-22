package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestScopedSnapshotRejectsOldClientsAndDowngrades(t *testing.T) {
	_, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "scopes@example.com")
	call := func(method string, p interface{}, version string) int {
		body, _ := json.Marshal(p)
		req := httptest.NewRequest(method, "/api/sync/snapshot", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+auth.Token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-TypeWords-Data-Format", version)
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		return res.Code
	}
	p := snapshotPayload(0, "scope-request-00001", map[string]int{"learned": 82})
	rows := p["rows"].([]map[string]interface{})
	rows[2]["data_version"] = 3
	rows[2]["data"] = map[string]interface{}{"schemaVersion": 3, "entries": map[string]interface{}{}}
	if got := call("PUT", p, "3"); got != 200 {
		t.Fatalf("upgrade: %d", got)
	}
	if got := call("GET", nil, ""); got != 428 {
		t.Fatalf("old read: %d", got)
	}
	if got := call("GET", nil, "3"); got != 200 {
		t.Fatalf("new read: %d", got)
	}
	if got := call("PUT", snapshotPayload(1, "scope-downgrade-001", nil), "3"); got != 428 {
		t.Fatalf("downgrade: %d", got)
	}
	p["expectedRevision"] = 1
	p["requestId"] = "scope-old-write-001"
	if got := call("PUT", p, ""); got != 428 {
		t.Fatalf("old write: %d", got)
	}
}

func snapshotPayload(revision int64, id string, value interface{}) map[string]interface{} {
	return map[string]interface{}{"expectedRevision": revision, "requestId": id, "rows": []map[string]interface{}{
		{"type": "dict", "data": value, "data_version": 4},
		{"type": "setting", "data": map[string]interface{}{}, "data_version": 25},
		{"type": "practice_word", "data": nil, "data_version": 1},
		{"type": "practice_article", "data": nil, "data_version": 1},
	}}
}

func TestSafeSyncConflictIdempotencyAndHistory(t *testing.T) {
	_, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "safe@example.com")
	write := func(p interface{}, status int) {
		t.Helper()
		rec := requestJSON(t, mux, http.MethodPut, "/api/sync/snapshot", auth.Token, p)
		if rec.Code != status {
			t.Fatalf("status %d want %d: %s", rec.Code, status, rec.Body.String())
		}
	}
	p := snapshotPayload(0, "request-first-000001", map[string]int{"learned": 1000})
	write(p, 200)
	write(p, 200) // A lost acknowledgement must not create another revision.
	result := decodeResponse[syncSnapshot](t, requestJSON(t, mux, http.MethodGet, "/api/sync/snapshot", auth.Token, nil))
	if result.Revision != 1 {
		t.Fatalf("replayed write advanced revision: %d", result.Revision)
	}
	write(snapshotPayload(0, "stale-device-000001", map[string]int{"learned": 900}), 409)
	write(snapshotPayload(1, "request-first-000001", map[string]int{"learned": 900}), 409)
	p2 := snapshotPayload(1, "request-second-00001", map[string]int{"learned": 1100})
	p2["reason"] = "resolve"
	write(p2, 200)
	list := decodeResponse[[]struct {
		ID       string `json:"id"`
		Revision int64  `json:"revision"`
	}](t, requestJSON(t, mux, http.MethodGet, "/api/sync/history", auth.Token, nil))
	var historyID string
	for _, h := range list {
		if h.Revision == 2 {
			historyID = h.ID
		}
	}
	if historyID == "" || len(list) != 1 {
		t.Fatal("daily latest snapshot missing or duplicated")
	}
	history := decodeResponse[syncSnapshot](t, requestJSON(t, mux, http.MethodGet, fmt.Sprintf("/api/sync/history/%s", historyID), auth.Token, nil))
	if history.Revision != 2 {
		t.Fatal("wrong recovery snapshot")
	}
	other := registerTestUser(t, mux, "other-safe@example.com")
	if rec := requestJSON(t, mux, http.MethodGet, fmt.Sprintf("/api/sync/history/%s", historyID), other.Token, nil); rec.Code != 404 {
		t.Fatal("history leaked across accounts")
	}
	legacy := requestJSON(t, mux, http.MethodPut, "/api/sync/data", auth.Token, map[string]interface{}{"rows": []interface{}{}})
	if legacy.Code != 428 {
		t.Fatalf("old client was not blocked: %d", legacy.Code)
	}
	for _, path := range []string{"/api/sync/meta?types=dict", "/api/sync/data?types=practice_word"} {
		if rec := requestJSON(t, mux, http.MethodGet, path, auth.Token, nil); rec.Code != 428 {
			t.Fatal("old download could still overwrite local data")
		}
	}
	restore := snapshotPayload(2, "restore-request-0001", nil)
	restore["rows"] = p["rows"]
	restore["reason"] = "restore"
	write(restore, 200)
	restored := decodeResponse[syncSnapshot](t, requestJSON(t, mux, http.MethodGet, "/api/sync/snapshot", auth.Token, nil))
	if restored.Revision != 3 {
		t.Fatal("restore must create a new revision")
	}
	if string(restored.Rows[0].Data) != `{"learned":1000}` {
		t.Fatalf("wrong restored data %s", restored.Rows[0].Data)
	}
}

func TestSnapshotBackupFailureIsAtomic(t *testing.T) {
	s, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "atomic@example.com")
	if _, err := s.db.Exec(`CREATE TRIGGER fail_history BEFORE INSERT ON learning_history BEGIN SELECT RAISE(ABORT,'disk failure'); END;`); err != nil {
		t.Fatal(err)
	}
	rec := requestJSON(t, mux, http.MethodPut, "/api/sync/snapshot", auth.Token, snapshotPayload(0, "atomic-request-0001", map[string]int{"learned": 10}))
	if rec.Code != 500 {
		t.Fatal("expected backup failure")
	}
	current := decodeResponse[syncSnapshot](t, requestJSON(t, mux, http.MethodGet, "/api/sync/snapshot", auth.Token, nil))
	if current.Revision != 0 || len(current.Rows) != 0 {
		t.Fatal("failed backup changed live data")
	}
}

func TestScheduledBackupsDisabledByDefault(t *testing.T) {
	s, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "backup-status@example.com")
	s.adminUserIDs = map[int64]bool{auth.User.ID: true}
	t.Setenv("TYPEWORDS_SCHEDULED_BACKUPS", "false")
	value := decodeResponse[struct {
		Enabled bool `json:"enabled"`
	}](t, requestJSON(t, mux, http.MethodGet, "/api/admin/sync/backup-status", auth.Token, nil))
	if value.Enabled {
		t.Fatal("scheduled backups must remain disabled")
	}
}

func TestDailyLatestRetainsEffectiveDates(t *testing.T) {
	s, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "history-cost@example.com")
	now := time.Date(2026, 9, 16, 10, 0, 0, 0, time.UTC)
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshot := syncSnapshot{Revision: 1, Rows: []syncRow{{Type: "dict", Data: json.RawMessage(`{"learned":1}`)}}}
	if err = saveSyncHistory(tx, auth.User.ID, snapshot, "", now); err != nil {
		t.Fatal(err)
	}
	snapshot.Revision = 2
	if err = saveSyncHistory(tx, auth.User.ID, snapshot, "", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err = saveSyncHistory(tx, auth.User.ID, snapshot, "restore", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var count, revision int
	if err = tx.QueryRow(`SELECT count(*), max(revision) FROM learning_history`).Scan(&count, &revision); err != nil || count != 1 || revision != 2 {
		t.Fatalf("same-day latest: %d/%d %v", count, revision, err)
	}
	for _, days := range []int{2, 20, 90} {
		if err = saveSyncHistory(tx, auth.User.ID, snapshot, "", now.AddDate(0, 0, days)); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.QueryRow(`SELECT count(*) FROM learning_history`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("effective dates: %d %v", count, err)
	}
	var first string
	if err = tx.QueryRow(`SELECT min(day) FROM learning_history`).Scan(&first); err != nil || first != "2026-09-18" {
		t.Fatalf("wrong retained dates: %s %v", first, err)
	}
}
