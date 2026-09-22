package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestHistoryDedupDeleteUndoAndReceipt(t *testing.T) {
	s, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "daily@example.com")
	put := func(rev int64, id string, n int) {
		t.Helper()
		r := requestJSON(t, mux, "PUT", "/api/sync/snapshot", auth.Token, snapshotPayload(rev, id, map[string]int{"learned": n}))
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	put(0, "daily-first-000001", 10)
	put(1, "daily-identical-001", 10)
	current := decodeResponse[syncSnapshot](t, requestJSON(t, mux, "GET", "/api/sync/snapshot", auth.Token, nil))
	if current.Revision != 1 {
		t.Fatal("unchanged save advanced revision")
	}
	receipt := decodeResponse[map[string]int64](t, requestJSON(t, mux, "GET", "/api/sync/receipts/daily-identical-001", auth.Token, nil))
	if receipt["revision"] != 1 {
		t.Fatal("missing duplicate receipt")
	}
	list := decodeResponse[[]struct {
		ID string `json:"id"`
	}](t, requestJSON(t, mux, "GET", "/api/sync/history", auth.Token, nil))
	id := list[0].ID
	for _, method := range []string{"DELETE", "DELETE", "POST"} {
		path := "/api/sync/history/" + id
		if method == "POST" {
			path += "/undo"
		}
		if r := requestJSON(t, mux, method, path, auth.Token, nil); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	requestJSON(t, mux, "DELETE", "/api/sync/history/"+id, auth.Token, nil)
	put(1, "daily-new-after-delete", 20)
	if r := requestJSON(t, mux, "POST", "/api/sync/history/"+id+"/undo", auth.Token, nil); r.Code != 409 {
		t.Fatal("undo overwrote today's new history")
	}
	deleted := decodeResponse[syncSnapshot](t, requestJSON(t, mux, "GET", "/api/sync/history/"+id, auth.Token, nil))
	if deleted.Revision != 1 {
		t.Fatal("deleted point cannot be exported during grace period")
	}
	current = decodeResponse[syncSnapshot](t, requestJSON(t, mux, "GET", "/api/sync/snapshot", auth.Token, nil))
	if current.Revision != 2 {
		t.Fatal("history actions changed live data")
	}
	other := registerTestUser(t, mux, "daily-other@example.com")
	if r := requestJSON(t, mux, "DELETE", "/api/sync/history/"+id, other.Token, nil); r.Code != 404 {
		t.Fatal("cross-account delete")
	}
	if _, err := s.db.Exec(`UPDATE learning_history SET deleted_at=? WHERE id=?`, time.Now().UTC().Add(-25*time.Hour).Format(time.RFC3339Nano), id[2:]); err != nil {
		t.Fatal(err)
	}
	if r := requestJSON(t, mux, "POST", "/api/sync/history/"+id+"/undo", auth.Token, nil); r.Code != 404 {
		t.Fatal("expired undo allowed")
	}
}

func TestHistoryShanghaiMidnightAndNoEmptyPoint(t *testing.T) {
	s, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "midnight@example.com")
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	at := time.Date(2026, 9, 22, 15, 59, 59, 0, time.UTC)
	if err = saveSyncHistory(tx, auth.User.ID, syncSnapshot{}, "", at); err != nil {
		t.Fatal(err)
	}
	var n int
	tx.QueryRow(`SELECT count(*) FROM learning_history`).Scan(&n)
	if n != 0 {
		t.Fatal("empty history")
	}
	snap := syncSnapshot{Revision: 1, Rows: []syncRow{{Type: "dict", Data: json.RawMessage(`{}`)}}}
	if err = saveSyncHistory(tx, auth.User.ID, snap, "", at); err != nil {
		t.Fatal(err)
	}
	if err = saveSyncHistory(tx, auth.User.ID, snap, "", at.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var lo, hi string
	if err = tx.QueryRow(`SELECT min(day),max(day),count(*) FROM learning_history`).Scan(&lo, &hi, &n); err != nil || lo != "2026-09-22" || hi != "2026-09-23" || n != 2 {
		t.Fatalf("midnight %s %s %d %v", lo, hi, n, err)
	}
}

func TestFirstEmptyAccountSyncDoesNotCreateHistory(t *testing.T) {
	_, mux := newTestServer(t)
	auth := registerTestUser(t, mux, "empty-daily@example.com")
	r := requestJSON(t, mux, "PUT", "/api/sync/snapshot", auth.Token, snapshotPayload(0, "empty-account-00001", nil))
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	list := decodeResponse[[]map[string]interface{}](t, requestJSON(t, mux, "GET", "/api/sync/history", auth.Token, nil))
	if len(list) != 0 {
		t.Fatal("empty initialization counted as learning day")
	}
}
