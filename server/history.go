package main

import (
	"bytes"
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

var historyZone = time.FixedZone("Asia/Shanghai", 8*60*60)

func snapshotHasLearning(rows []syncRow) bool {
	for _, row := range rows {
		var data map[string]interface{}
		if json.Unmarshal(row.Data, &data) != nil || data == nil {
			continue
		}
		if row.Type == "dict" {
			word, known := data["word"].(map[string]interface{})
			if !known {
				if len(data) > 0 {
					return true
				}
				continue
			}
			groups := []map[string]interface{}{word}
			if article, ok := data["article"].(map[string]interface{}); ok {
				groups = append(groups, article)
			}
			for _, group := range groups {
				if books, ok := group["bookList"].([]interface{}); ok {
					for _, item := range books {
						if book, ok := item.(map[string]interface{}); ok {
							id, _ := book["id"].(string)
							if id != "wordCollect" && id != "wordWrong" && id != "wordKnown" && id != "articleCollect" {
								return true
							}
							for _, key := range []string{"words", "articles", "statistics"} {
								if list, ok := book[key].([]interface{}); ok && len(list) > 0 {
									return true
								}
							}
						}
					}
				}
			}
		}
		if row.Type == "practice_word" {
			if entries, ok := data["entries"].(map[string]interface{}); ok {
				for _, item := range entries {
					if entry, ok := item.(map[string]interface{}); ok && entry["data"] != nil {
						return true
					}
				}
				if data["unresolvedLegacy"] != nil {
					return true
				}
			} else if len(data) > 0 {
				return true
			}
		}
		if row.Type == "practice_article" && len(data) > 0 {
			return true
		}
	}
	return false
}

func migrateLearningHistory(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS learning_history(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,day TEXT NOT NULL,created_at TEXT NOT NULL,summary TEXT NOT NULL,payload BLOB NOT NULL,deleted_at TEXT NOT NULL DEFAULT '');
 CREATE UNIQUE INDEX IF NOT EXISTS history_active_day ON learning_history(user_id,day) WHERE deleted_at='';
 CREATE TABLE IF NOT EXISTS legacy_history_deleted(user_id INTEGER NOT NULL,id INTEGER NOT NULL,deleted_at TEXT NOT NULL,PRIMARY KEY(user_id,id));`)
	return err
}

func semanticRows(rows []syncRow) ([]byte, error) {
	result := map[string]interface{}{}
	for _, row := range rows {
		var data interface{}
		if err := json.Unmarshal(row.Data, &data); err != nil {
			return nil, err
		}
		if obj, ok := data.(map[string]interface{}); ok {
			if row.Type == "dict" || row.Type == "setting" {
				delete(obj, "load")
				delete(obj, "_ignoreWatch")
				delete(obj, "__updateLocalData")
			}
			if row.Type == "practice_word" {
				if entries, ok := obj["entries"].(map[string]interface{}); ok {
					for _, entry := range entries {
						if e, ok := entry.(map[string]interface{}); ok {
							delete(e, "updatedAt")
						}
					}
				}
			}
		}
		result[row.Type] = data
	}
	return json.Marshal(result)
}

func historySummary(snapshot syncSnapshot) string {
	result := map[string]interface{}{"books": []interface{}{}, "unfinished": 0}
	for _, row := range snapshot.Rows {
		var data map[string]interface{}
		if json.Unmarshal(row.Data, &data) != nil {
			continue
		}
		if row.Type == "dict" {
			if word, ok := data["word"].(map[string]interface{}); ok {
				if books, ok := word["bookList"].([]interface{}); ok {
					list := []interface{}{}
					for _, entry := range books {
						if book, ok := entry.(map[string]interface{}); ok {
							if id, ok := book["id"].(string); ok && (id == "wordCollect" || id == "wordWrong" || id == "wordKnown") {
								continue
							}
							learned := book["lastLearnIndex"]
							if learning, ok := book["learning"].(map[string]interface{}); ok {
								if words, ok := learning["learnedWords"].([]interface{}); ok {
									learned = len(words)
								}
							}
							list = append(list, map[string]interface{}{"id": book["id"], "name": book["name"], "learned": learned})
						}
					}
					result["books"] = list
				}
			}
		}
		if row.Type == "practice_word" {
			if entries, ok := data["entries"].(map[string]interface{}); ok {
				n := 0
				for _, entry := range entries {
					if e, ok := entry.(map[string]interface{}); ok && e["data"] != nil {
						n++
					}
				}
				result["unfinished"] = n
			}
		}
	}
	raw, _ := json.Marshal(result)
	return string(raw)
}

func saveSyncHistory(tx *sql.Tx, userID int64, snapshot syncSnapshot, _ string, now time.Time) error {
	if len(snapshot.Rows) == 0 {
		return nil
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	var buffer bytes.Buffer
	z := gzip.NewWriter(&buffer)
	if _, err = z.Write(raw); err != nil {
		return err
	}
	if err = z.Close(); err != nil {
		return err
	}
	day := now.In(historyZone).Format("2006-01-02")
	_, err = tx.Exec(`INSERT INTO learning_history(user_id,revision,day,created_at,summary,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,day) WHERE deleted_at='' DO UPDATE SET revision=excluded.revision,created_at=excluded.created_at,summary=excluded.summary,payload=excluded.payload`, userID, snapshot.Revision, day, now.Format(time.RFC3339Nano), historySummary(snapshot), buffer.Bytes())
	if err != nil {
		return err
	}
	_, err = tx.Exec(`DELETE FROM learning_history WHERE user_id=? AND deleted_at='' AND day NOT IN(SELECT day FROM learning_history WHERE user_id=? AND deleted_at='' ORDER BY day DESC LIMIT 3)`, userID, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`DELETE FROM learning_history WHERE user_id=? AND deleted_at<>'' AND deleted_at<?`, userID, now.Add(-24*time.Hour).Format(time.RFC3339Nano))
	return err
}

func (s *server) syncHistory(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	id := r.PathValue("id")
	if id != "" {
		s.historyItem(w, r, user, id)
		return
	}
	rows, err := s.db.Query(`SELECT 'd-'||id,revision,'daily-latest',day,created_at,summary,deleted_at FROM learning_history WHERE user_id=? AND (deleted_at='' OR deleted_at>=?) UNION ALL SELECT CAST(h.id AS TEXT),h.revision,'legacy-'||h.kind,h.bucket,h.created_at,'{}',COALESCE(d.deleted_at,'') FROM sync_history h LEFT JOIN legacy_history_deleted d ON d.user_id=h.user_id AND d.id=h.id WHERE h.user_id=? AND (d.deleted_at IS NULL OR d.deleted_at>=?) ORDER BY 5 DESC`, user.ID, time.Now().UTC().Add(-24*time.Hour).Format(time.RFC3339Nano), user.ID, time.Now().UTC().Add(-24*time.Hour).Format(time.RFC3339Nano))
	if err != nil {
		writeError(w, 500, "unable to list history")
		return
	}
	defer rows.Close()
	result := []map[string]interface{}{}
	for rows.Next() {
		var id, kind, day, created, summary, deleted string
		var revision int64
		if rows.Scan(&id, &revision, &kind, &day, &created, &summary, &deleted) != nil {
			writeError(w, 500, "invalid history")
			return
		}
		result = append(result, map[string]interface{}{"id": id, "revision": revision, "kind": kind, "day": day, "createdAt": created, "summary": json.RawMessage(summary), "deletedAt": deleted})
	}
	if rows.Err() != nil {
		writeError(w, 500, "unable to read history")
		return
	}
	writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: result})
}
func (s *server) historyItem(w http.ResponseWriter, r *http.Request, user userView, id string) {
	daily := strings.HasPrefix(id, "d-")
	key := strings.TrimPrefix(id, "d-")
	var payload []byte
	var deleted, day string
	var err error
	if daily {
		err = s.db.QueryRow(`SELECT payload,deleted_at,day FROM learning_history WHERE user_id=? AND id=?`, user.ID, key).Scan(&payload, &deleted, &day)
	} else {
		err = s.db.QueryRow(`SELECT h.payload,COALESCE(d.deleted_at,''),h.bucket FROM sync_history h LEFT JOIN legacy_history_deleted d ON d.user_id=h.user_id AND d.id=h.id WHERE h.user_id=? AND h.id=?`, user.ID, key).Scan(&payload, &deleted, &day)
	}
	if err == sql.ErrNoRows {
		writeError(w, 404, "history not found")
		return
	}
	if err != nil {
		writeError(w, 500, "unable to read history")
		return
	}
	if deleted != "" {
		at, err := time.Parse(time.RFC3339Nano, deleted)
		if err != nil || time.Since(at) >= 24*time.Hour {
			writeError(w, 404, "history deletion expired")
			return
		}
	}
	if r.Method == http.MethodDelete || r.Method == http.MethodPost {
		undo := r.Method == http.MethodPost
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		if deleted != "" {
			stamp = deleted
		}
		if undo {
			stamp = ""
		}
		if daily {
			var tx *sql.Tx
			tx, err = s.db.Begin()
			if err != nil {
				writeError(w, 500, "unable to update history")
				return
			}
			defer tx.Rollback()
			_, err = tx.Exec(`UPDATE learning_history SET deleted_at=? WHERE user_id=? AND id=?`, stamp, user.ID, key)
			if err == nil && undo {
				var newer int
				err = tx.QueryRow(`SELECT count(*) FROM learning_history WHERE user_id=? AND deleted_at='' AND day>?`, user.ID, day).Scan(&newer)
				if err == nil && newer >= 3 {
					writeError(w, 409, "这份副本超出3个保留日期，请先导出")
					return
				}
				if err == nil {
					_, err = tx.Exec(`DELETE FROM learning_history WHERE user_id=? AND deleted_at='' AND day NOT IN(SELECT day FROM learning_history WHERE user_id=? AND deleted_at='' ORDER BY day DESC LIMIT 3)`, user.ID, user.ID)
				}
			}
			if err == nil {
				err = tx.Commit()
			}
		} else if undo {
			_, err = s.db.Exec(`DELETE FROM legacy_history_deleted WHERE user_id=? AND id=?`, user.ID, key)
		} else {
			_, err = s.db.Exec(`INSERT INTO legacy_history_deleted(user_id,id,deleted_at) VALUES(?,?,?) ON CONFLICT(user_id,id) DO NOTHING`, user.ID, key, stamp)
		}
		if err != nil {
			writeError(w, 409, "当天已有更新副本，不能用撤销删除覆盖它")
			return
		}
		writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: true})
		return
	}
	z, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		writeError(w, 500, "invalid history")
		return
	}
	defer z.Close()
	raw, err := io.ReadAll(io.LimitReader(z, maxRequestBytes+1))
	if err != nil || len(raw) > maxRequestBytes {
		writeError(w, 500, "invalid history")
		return
	}
	writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: json.RawMessage(raw)})
}
func (s *server) syncReceipt(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	var revision int64
	err := s.db.QueryRow(`SELECT revision FROM sync_receipts WHERE user_id=? AND request_id=?`, user.ID, r.PathValue("id")).Scan(&revision)
	if err == sql.ErrNoRows {
		writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: nil})
		return
	}
	if err != nil {
		writeError(w, 500, "unable to read receipt")
		return
	}
	writeJSON(w, 200, apiResponse{Success: true, Code: 200, Data: map[string]int64{"revision": revision}})
}
