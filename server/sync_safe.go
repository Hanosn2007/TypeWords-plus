package main

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type syncSnapshot struct {
	Revision int64     `json:"revision"`
	Rows     []syncRow `json:"rows"`
}

func migrateSafeSync(db *sql.DB) error {
	_, err := db.Exec(`
 CREATE TABLE IF NOT EXISTS sync_state(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sync_receipts(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL, digest TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(user_id,request_id));
 CREATE TABLE IF NOT EXISTS sync_history(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL, kind TEXT NOT NULL, bucket TEXT NOT NULL, created_at TEXT NOT NULL, payload BLOB NOT NULL, UNIQUE(user_id,kind,bucket));
 CREATE INDEX IF NOT EXISTS sync_history_user ON sync_history(user_id,id);
 `)
	if err != nil {
		return err
	}
	return migrateLearningHistory(db)
}

func readSyncSnapshot(tx *sql.Tx, userID int64) (syncSnapshot, error) {
	result := syncSnapshot{Rows: []syncRow{}}
	err := tx.QueryRow(`SELECT revision FROM sync_state WHERE user_id=?`, userID).Scan(&result.Revision)
	if err != nil && err != sql.ErrNoRows {
		return result, err
	}
	rows, err := tx.Query(`SELECT type,data,data_version,updated_at,revision FROM sync_items WHERE user_id=? ORDER BY type`, userID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var r syncRow
		var raw string
		var version sql.NullInt64
		if err = rows.Scan(&r.Type, &raw, &version, &r.UpdatedAt, &r.Revision); err != nil {
			return result, err
		}
		r.Data = json.RawMessage(raw)
		if version.Valid {
			v := int(version.Int64)
			r.DataVersion = &v
		}
		result.Rows = append(result.Rows, r)
	}
	return result, rows.Err()
}

func (s *server) safeSyncGet(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "unable to read snapshot")
		return
	}
	defer tx.Rollback()
	snapshot, err := readSyncSnapshot(tx, user.ID)
	if err != nil {
		writeError(w, 500, "unable to read snapshot")
		return
	}
	if snapshotNeedsScopes(snapshot) && r.Header.Get("X-TypeWords-Data-Format") != "3" {
		writeError(w, 428, "please update the page before reading unit-scoped learning data")
		return
	}
	writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: snapshot})
}

func snapshotNeedsScopes(snapshot syncSnapshot) bool {
	for _, row := range snapshot.Rows {
		if row.Type == "practice_word" && row.DataVersion != nil && *row.DataVersion >= 3 {
			return true
		}
	}
	return false
}

func (s *server) safeSyncPut(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	var p struct {
		ExpectedRevision *int64    `json:"expectedRevision"`
		RequestID        string    `json:"requestId"`
		Reason           string    `json:"reason"`
		Rows             []syncRow `json:"rows"`
	}
	if json.NewDecoder(r.Body).Decode(&p) != nil || p.ExpectedRevision == nil || *p.ExpectedRevision < 0 || len(p.RequestID) < 16 || len(p.RequestID) > 100 || len(p.Rows) != len(allowedSyncTypes) {
		writeError(w, 400, "a complete snapshot, requestId and expectedRevision are required")
		return
	}
	if p.Reason != "" && p.Reason != "resolve" && p.Reason != "restore" {
		writeError(w, 400, "invalid reason")
		return
	}
	seen := map[string]bool{}
	for _, row := range p.Rows {
		if !allowedSyncTypes[row.Type] || seen[row.Type] || !json.Valid(row.Data) || row.DataVersion == nil || *row.DataVersion < 1 {
			writeError(w, 400, "invalid snapshot row")
			return
		}
		if *row.DataVersion > map[string]int{"dict": 4, "setting": 25, "practice_word": 3, "practice_article": 1}[row.Type] {
			writeError(w, 428, "unsupported data version")
			return
		}
		if row.Type == "practice_word" && string(row.Data) != "null" {
			var task map[string]interface{}
			if json.Unmarshal(row.Data, &task) != nil {
				writeError(w, 400, "invalid task format")
				return
			}
			if *row.DataVersion == 3 {
				if task["schemaVersion"] != float64(3) {
					writeError(w, 400, "task schema/version mismatch")
					return
				}
				if _, ok := task["entries"].(map[string]interface{}); !ok {
					writeError(w, 400, "invalid task entries")
					return
				}
			} else if version, ok := task["schemaVersion"].(float64); ok && version > 2 {
				writeError(w, 400, "task schema/version mismatch")
				return
			}
		}
		seen[row.Type] = true
	}
	canonical, _ := json.Marshal(p)
	h := sha256.Sum256(canonical)
	digest := hex.EncodeToString(h[:])
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "unable to save snapshot")
		return
	}
	defer tx.Rollback()
	var priorDigest string
	var priorRevision int64
	err = tx.QueryRow(`SELECT digest,revision FROM sync_receipts WHERE user_id=? AND request_id=?`, user.ID, p.RequestID).Scan(&priorDigest, &priorRevision)
	if err == nil {
		if priorDigest != digest {
			writeError(w, 409, "requestId was used for different data")
			return
		}
		writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: map[string]int64{"revision": priorRevision}})
		return
	}
	if err != sql.ErrNoRows {
		writeError(w, 500, "unable to read receipt")
		return
	}
	current, err := readSyncSnapshot(tx, user.ID)
	if err != nil {
		writeError(w, 500, "unable to read snapshot")
		return
	}
	if snapshotNeedsScopes(current) && (r.Header.Get("X-TypeWords-Data-Format") != "3" || !snapshotNeedsScopes(syncSnapshot{Rows: p.Rows})) {
		writeError(w, 428, "please update the page; downgrading unit-scoped learning data is not supported")
		return
	}
	if snapshotNeedsScopes(syncSnapshot{Rows: p.Rows}) && r.Header.Get("X-TypeWords-Data-Format") != "3" {
		writeError(w, 428, "unit-scoped learning requires an updated client")
		return
	}
	if current.Revision != *p.ExpectedRevision {
		writeError(w, 409, "cloud data changed; both versions have been preserved")
		return
	}
	before, _ := semanticRows(current.Rows)
	incoming, _ := semanticRows(p.Rows)
	contentChanged := !bytes.Equal(before, incoming)
	formatChanged := false
	for _, row := range p.Rows {
		for _, prior := range current.Rows {
			if row.Type == prior.Type && prior.DataVersion != nil && *row.DataVersion != *prior.DataVersion {
				formatChanged = true
			}
		}
	}
	if !contentChanged && !formatChanged {
		_, err = tx.Exec("INSERT INTO sync_receipts(user_id,request_id,digest,revision) VALUES(?,?,?,?)", user.ID, p.RequestID, digest, current.Revision)
		if err == nil {
			err = retainSyncReceipts(tx, user.ID)
		}
		if err != nil || tx.Commit() != nil {
			writeError(w, 500, "unable to record receipt")
			return
		}
		writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: map[string]int64{"revision": current.Revision}})
		return
	}
	now := time.Now().UTC()
	next := current.Revision + 1
	if contentChanged && (len(current.Rows) > 0 || snapshotHasLearning(p.Rows)) {
		if err = saveSyncHistory(tx, user.ID, syncSnapshot{Revision: next, Rows: p.Rows}, p.Reason, now); err != nil {
			writeError(w, 500, "unable to save daily history; no data changed")
			return
		}
	}
	for _, row := range p.Rows {
		_, err = tx.Exec(`INSERT INTO sync_items(user_id,type,data,data_version,updated_at,revision) VALUES(?,?,?,?,?,1) ON CONFLICT(user_id,type) DO UPDATE SET data=excluded.data,data_version=excluded.data_version,updated_at=excluded.updated_at,revision=sync_items.revision+1`, user.ID, row.Type, string(row.Data), *row.DataVersion, now.Format(time.RFC3339Nano))
		if err != nil {
			writeError(w, 500, "unable to save snapshot")
			return
		}
	}
	_, err = tx.Exec(`INSERT INTO sync_state(user_id,revision) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision`, user.ID, next)
	if err != nil {
		writeError(w, 500, "unable to save revision")
		return
	}
	_, err = tx.Exec(`INSERT INTO sync_receipts(user_id,request_id,digest,revision) VALUES(?,?,?,?)`, user.ID, p.RequestID, digest, next)
	if err != nil {
		writeError(w, 500, "unable to save receipt")
		return
	}
	err = retainSyncReceipts(tx, user.ID)
	if err != nil {
		writeError(w, 500, "unable to retain receipts")
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, 500, "unable to commit snapshot")
		return
	}
	writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: map[string]int64{"revision": next}})
}

func retainSyncReceipts(tx *sql.Tx, userID int64) error {
	_, err := tx.Exec(`DELETE FROM sync_receipts WHERE user_id=? AND rowid NOT IN (SELECT rowid FROM sync_receipts WHERE user_id=? ORDER BY rowid DESC LIMIT 1000)`, userID, userID)
	return err
}

func (s *server) rejectLegacySyncWrite(w http.ResponseWriter, _ *http.Request, _ userView, _ string) {
	writeError(w, http.StatusPreconditionRequired, "同步协议已升级，请保留本机数据并刷新页面；旧版本不能覆盖云端")
}

func (s *server) backupStatus(w http.ResponseWriter, _ *http.Request, _ userView, _ string) {
	if !envBool("TYPEWORDS_SCHEDULED_BACKUPS", false) {
		writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: map[string]interface{}{"enabled": false, "server": nil, "mac": nil}})
		return
	}
	root := envOr("TYPEWORDS_BACKUP_DIR", "/opt/typewords/backups/daily")
	result := map[string]interface{}{"enabled": true}
	for key, name := range map[string]string{"server": "latest.json", "mac": "last-mac-copy.json"} {
		raw, err := os.ReadFile(filepath.Join(root, name))
		if os.IsNotExist(err) {
			result[key] = nil
			continue
		}
		if err != nil {
			writeError(w, 500, "unable to read backup status")
			return
		}
		var value map[string]interface{}
		if json.Unmarshal(raw, &value) != nil {
			writeError(w, 500, "invalid backup status")
			return
		}
		result[key] = value
	}
	writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: result})
}
