package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type libraryContent struct {
	Name              string        `json:"name"`
	Description       string        `json:"description"`
	Language          string        `json:"language"`
	TranslateLanguage string        `json:"translateLanguage"`
	Category          string        `json:"category"`
	Tags              []string      `json:"tags"`
	Recommended       bool          `json:"recommended"`
	SortOrder         int           `json:"sortOrder"`
	Cover             string        `json:"cover,omitempty"`
	Words             []libraryWord `json:"words"`
	Units             []libraryUnit `json:"units"`
}

type libraryTextPair struct {
	C  string `json:"c"`
	CN string `json:"cn"`
}

type libraryTranslation struct {
	POS       string `json:"pos"`
	CN        string `json:"cn"`
	Frequency *int   `json:"frequency,omitempty"`
}

type librarySynonym struct {
	POS string   `json:"pos"`
	CN  string   `json:"cn"`
	WS  []string `json:"ws"`
}

type libraryRelatedWords struct {
	POS   string            `json:"pos"`
	Words []libraryTextPair `json:"words"`
}

type libraryEtymology struct {
	T string `json:"t"`
	D string `json:"d"`
}

type libraryWord struct {
	ID        string               `json:"id,omitempty"`
	Custom    bool                 `json:"custom,omitempty"`
	Word      string               `json:"word"`
	Phonetic0 string               `json:"phonetic0"`
	Phonetic1 string               `json:"phonetic1"`
	Trans     []libraryTranslation `json:"trans"`
	Sentences []libraryTextPair    `json:"sentences"`
	Phrases   []libraryTextPair    `json:"phrases"`
	Synos     []librarySynonym     `json:"synos"`
	RelWords  struct {
		Root string                `json:"root"`
		Rels []libraryRelatedWords `json:"rels"`
	} `json:"relWords"`
	Etymology []libraryEtymology `json:"etymology"`
}

type libraryUnit struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Words []string `json:"words"`
}

type libraryAdminBook struct {
	ID                    string         `json:"id"`
	Draft                 libraryContent `json:"draft"`
	DraftRevision         int64          `json:"draftRevision"`
	PublishedVersion      int64          `json:"publishedVersion"`
	CreatedAt             string         `json:"createdAt"`
	UpdatedAt             string         `json:"updatedAt"`
	CreatedBy             int64          `json:"createdBy"`
	Name                  string         `json:"name"`
	Length                int            `json:"length"`
	UnitsCount            int            `json:"unitsCount"`
	Recommended           bool           `json:"recommended"`
	SortOrder             int            `json:"sortOrder"`
	HasUnpublishedChanges bool           `json:"hasUnpublishedChanges"`
}

type libraryAdminSummary struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	DraftRevision         int64  `json:"draftRevision"`
	PublishedVersion      int64  `json:"publishedVersion"`
	UpdatedAt             string `json:"updatedAt"`
	Length                int    `json:"length"`
	UnitsCount            int    `json:"unitsCount"`
	Recommended           bool   `json:"recommended"`
	SortOrder             int    `json:"sortOrder"`
	HasUnpublishedChanges bool   `json:"hasUnpublishedChanges"`
}

func (book *libraryAdminBook) summarizeDraft() {
	book.Name, book.Length, book.UnitsCount = book.Draft.Name, len(book.Draft.Words), len(book.Draft.Units)
	book.Recommended, book.SortOrder = book.Draft.Recommended, book.Draft.SortOrder
}

func (book libraryAdminBook) summary() libraryAdminSummary {
	return libraryAdminSummary{book.ID, book.Name, book.DraftRevision, book.PublishedVersion, book.UpdatedAt, book.Length, book.UnitsCount, book.Recommended, book.SortOrder, book.HasUnpublishedChanges}
}

type libraryRelease struct {
	ID        string         `json:"id"`
	Version   int64          `json:"version"`
	Content   libraryContent `json:"content"`
	UpdatedAt string         `json:"updatedAt"`
}

type libraryReleaseInfo struct {
	Version   int64  `json:"version"`
	Note      string `json:"note"`
	UpdatedAt string `json:"updatedAt"`
	CreatedBy int64  `json:"createdBy"`
}

type librarySummary struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Language          string   `json:"language"`
	TranslateLanguage string   `json:"translateLanguage"`
	Category          string   `json:"category"`
	Tags              []string `json:"tags"`
	Recommended       bool     `json:"recommended"`
	SortOrder         int      `json:"sortOrder"`
	Cover             string   `json:"cover,omitempty"`
	Length            int      `json:"length"`
	Version           int64    `json:"version"`
	UpdatedAt         string   `json:"updatedAt"`
}

type libraryFeedback struct {
	ID        int64  `json:"id"`
	BookID    string `json:"bookId"`
	BookName  string `json:"bookName"`
	Version   int64  `json:"version"`
	Word      string `json:"word"`
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	UserID    int64  `json:"userId"`
	Status    string `json:"status"`
	Reply     string `json:"reply"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("GET /api/auth/me", s.withUser(s.me))
	mux.HandleFunc("POST /api/auth/logout", s.withUser(s.logout))
	mux.HandleFunc("GET /api/sync/meta", s.withUser(s.rejectLegacySyncWrite))
	mux.HandleFunc("GET /api/sync/data", s.withUser(s.rejectLegacySyncWrite))
	mux.HandleFunc("PUT /api/sync/data", s.withUser(s.rejectLegacySyncWrite))
	mux.HandleFunc("GET /api/sync/snapshot", s.withUser(s.safeSyncGet))
	mux.HandleFunc("PUT /api/sync/snapshot", s.withUser(s.safeSyncPut))
	mux.HandleFunc("GET /api/sync/history", s.withUser(s.syncHistory))
	mux.HandleFunc("GET /api/sync/history/{id}", s.withUser(s.syncHistory))
	mux.HandleFunc("GET /api/admin/sync/backup-status", s.withAdmin(s.backupStatus))
	mux.HandleFunc("GET /api/library/books", s.libraryBooks)
	mux.HandleFunc("GET /api/library/books/{id}", s.libraryBook)
	mux.HandleFunc("POST /api/library/books/{id}/feedback", s.withUser(s.libraryCreateFeedback))
	mux.HandleFunc("GET /api/library/feedback", s.withUser(s.libraryOwnFeedback))
	mux.HandleFunc("GET /api/admin/library/books", s.withAdmin(s.libraryAdminBooks))
	mux.HandleFunc("POST /api/admin/library/books", s.withAdmin(s.libraryCreateBook))
	mux.HandleFunc("GET /api/admin/library/books/{id}", s.withAdmin(s.libraryAdminBook))
	mux.HandleFunc("PUT /api/admin/library/books/{id}/draft", s.withAdmin(s.librarySaveDraft))
	mux.HandleFunc("POST /api/admin/library/books/{id}/validate", s.withAdmin(s.libraryValidate))
	mux.HandleFunc("POST /api/admin/library/books/{id}/publish", s.withAdmin(s.libraryPublish))
	mux.HandleFunc("GET /api/admin/library/books/{id}/releases", s.withAdmin(s.libraryReleases))
	mux.HandleFunc("GET /api/admin/library/books/{id}/releases/{version}", s.withAdmin(s.libraryAdminRelease))
	mux.HandleFunc("POST /api/admin/library/books/{id}/rollback", s.withAdmin(s.libraryRollback))
	mux.HandleFunc("GET /api/admin/library/feedback", s.withAdmin(s.libraryAllFeedback))
	mux.HandleFunc("PATCH /api/admin/library/feedback/{id}", s.withAdmin(s.libraryUpdateFeedback))
	return mux
}

func migrateLibrary(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS library_books (
			id TEXT PRIMARY KEY,
			draft_json TEXT NOT NULL,
			draft_revision INTEGER NOT NULL DEFAULT 1,
			published_version INTEGER NOT NULL DEFAULT 0,
			created_by INTEGER NOT NULL REFERENCES users(id),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS library_releases (
			book_id TEXT NOT NULL REFERENCES library_books(id),
			version INTEGER NOT NULL,
			content_json TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL REFERENCES users(id),
			created_at TEXT NOT NULL,
			PRIMARY KEY (book_id, version)
		);
		CREATE TABLE IF NOT EXISTS library_feedback (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			book_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			word TEXT NOT NULL DEFAULT '',
			kind TEXT NOT NULL,
			message TEXT NOT NULL,
			user_id INTEGER NOT NULL REFERENCES users(id),
			status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
			reply TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (book_id, version) REFERENCES library_releases(book_id, version)
		);
		CREATE INDEX IF NOT EXISTS library_feedback_user_idx ON library_feedback(user_id, id DESC);
		CREATE INDEX IF NOT EXISTS library_feedback_status_idx ON library_feedback(status, book_id, id DESC);
	`)
	return err
}

func configuredAdminUserIDs(db *sql.DB, raw string) (map[int64]bool, error) {
	ids := make(map[int64]bool)
	if strings.TrimSpace(raw) == "" {
		return ids, nil
	}
	for _, item := range strings.Split(raw, ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		if err != nil || id <= 0 {
			return nil, errors.New("TYPEWORDS_ADMIN_USER_IDS must contain comma-separated positive existing user IDs")
		}
		var found int64
		if err := db.QueryRow(`SELECT id FROM users WHERE id = ?`, id).Scan(&found); err != nil {
			return nil, fmt.Errorf("TYPEWORDS_ADMIN_USER_IDS: user ID %d does not exist or cannot be loaded", id)
		}
		ids[id] = true
	}
	return ids, nil
}

func (s *server) withAdmin(next func(http.ResponseWriter, *http.Request, userView, string)) http.HandlerFunc {
	return s.withUser(func(w http.ResponseWriter, r *http.Request, user userView, token string) {
		w.Header().Set("Cache-Control", "no-store")
		if !user.IsAdmin {
			writeError(w, http.StatusForbidden, "administrator access required")
			return
		}
		next(w, r, user, token)
	})
}

func libraryJSON(w http.ResponseWriter, status int, data interface{}) {
	writeJSON(w, status, apiResponse{Success: true, Code: status, Data: data})
}

func decodeLibraryJSON(w http.ResponseWriter, r *http.Request, value interface{}, allowEmpty bool) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		if allowEmpty && errors.Is(err, io.EOF) {
			return true
		}
		writeError(w, http.StatusBadRequest, "invalid library payload: "+err.Error())
		return false
	}
	if err := decoder.Decode(new(interface{})); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "library payload must contain one JSON value")
		return false
	}
	return true
}

type libraryScanner interface{ Scan(...interface{}) error }

const libraryBookColumns = `id, draft_json, draft_revision, published_version, created_at, updated_at, created_by, (published_version=0 OR draft_json <> (SELECT content_json FROM library_releases WHERE book_id=library_books.id AND version=published_version))`

func scanLibraryBook(row libraryScanner) (libraryAdminBook, error) {
	var book libraryAdminBook
	var raw string
	err := row.Scan(&book.ID, &raw, &book.DraftRevision, &book.PublishedVersion, &book.CreatedAt, &book.UpdatedAt, &book.CreatedBy, &book.HasUnpublishedChanges)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &book.Draft)
	}
	book.summarizeDraft()
	return book, err
}

func libraryReadError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "library book, version or feedback not found")
	} else {
		writeError(w, http.StatusInternalServerError, "unable to load library data")
	}
	return true
}

func (s *server) libraryAdminBooks(w http.ResponseWriter, _ *http.Request, _ userView, _ string) {
	rows, err := s.db.Query(`SELECT ` + libraryBookColumns + ` FROM library_books ORDER BY updated_at DESC, id`)
	if libraryReadError(w, err) {
		return
	}
	defer rows.Close()
	books := []libraryAdminSummary{}
	for rows.Next() {
		book, err := scanLibraryBook(rows)
		if libraryReadError(w, err) {
			return
		}
		books = append(books, book.summary())
	}
	if !libraryReadError(w, rows.Err()) {
		libraryJSON(w, http.StatusOK, books)
	}
}

func (s *server) libraryAdminBook(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	book, err := scanLibraryBook(s.db.QueryRow(`SELECT `+libraryBookColumns+` FROM library_books WHERE id = ?`, r.PathValue("id")))
	if !libraryReadError(w, err) {
		libraryJSON(w, http.StatusOK, book)
	}
}

func (s *server) libraryCreateBook(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	var payload struct {
		Content *libraryContent `json:"content"`
	}
	if !decodeLibraryJSON(w, r, &payload, true) {
		return
	}
	content := libraryContent{Language: "en", TranslateLanguage: "zh-CN"}
	if payload.Content != nil {
		content = *payload.Content
	}
	if !prepareLibraryDraft(w, &content) {
		return
	}
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "unable to create library book")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	book := libraryAdminBook{ID: "library-" + hex.EncodeToString(idBytes), Draft: content, DraftRevision: 1, CreatedAt: now, UpdatedAt: now, CreatedBy: user.ID, HasUnpublishedChanges: true}
	book.summarizeDraft()
	raw, _ := json.Marshal(content)
	_, err := s.db.Exec(`INSERT INTO library_books(id,draft_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?)`, book.ID, string(raw), user.ID, now, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to create library book")
		return
	}
	libraryJSON(w, http.StatusCreated, book)
}

func (s *server) librarySaveDraft(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	var payload struct {
		ExpectedRevision int64           `json:"expectedRevision"`
		Content          *libraryContent `json:"content"`
	}
	if !decodeLibraryJSON(w, r, &payload, false) {
		return
	}
	if payload.ExpectedRevision < 1 || payload.Content == nil {
		writeError(w, http.StatusBadRequest, "content and a positive expectedRevision are required")
		return
	}
	if !prepareLibraryDraft(w, payload.Content) {
		return
	}
	raw, _ := json.Marshal(payload.Content)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to save library draft")
		return
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE library_books SET draft_json=?,draft_revision=draft_revision+1,updated_at=? WHERE id=? AND draft_revision=?`, string(raw), now, r.PathValue("id"), payload.ExpectedRevision)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to save library draft")
		return
	}
	changed, _ := result.RowsAffected()
	book, err := scanLibraryBook(tx.QueryRow(`SELECT `+libraryBookColumns+` FROM library_books WHERE id=?`, r.PathValue("id")))
	if libraryReadError(w, err) {
		return
	}
	if changed == 0 {
		writeError(w, http.StatusConflict, "draft changed; reload before saving")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "unable to save library draft")
		return
	}
	libraryJSON(w, http.StatusOK, book)
}

func (s *server) libraryValidate(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	var payload struct {
		Content *libraryContent `json:"content"`
	}
	if !decodeLibraryJSON(w, r, &payload, true) {
		return
	}
	book, err := scanLibraryBook(s.db.QueryRow(`SELECT `+libraryBookColumns+` FROM library_books WHERE id=?`, r.PathValue("id")))
	if libraryReadError(w, err) {
		return
	}
	if payload.Content != nil {
		book.Draft = *payload.Content
	}
	libraryJSON(w, http.StatusOK, validateLibraryContent(book.Draft))
}

func (s *server) libraryPublish(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	s.libraryPublishVersion(w, r, user, false)
}

func (s *server) libraryRollback(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	s.libraryPublishVersion(w, r, user, true)
}

func (s *server) libraryPublishVersion(w http.ResponseWriter, r *http.Request, user userView, rollback bool) {
	var payload struct {
		ExpectedRevision int64  `json:"expectedRevision"`
		Version          int64  `json:"version,omitempty"`
		Note             string `json:"note"`
	}
	if !decodeLibraryJSON(w, r, &payload, false) {
		return
	}
	if payload.ExpectedRevision < 1 || len(payload.Note) > 4000 || (rollback && payload.Version < 1) || (!rollback && payload.Version != 0) {
		writeError(w, http.StatusBadRequest, "invalid expectedRevision, version or release note")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to publish library book")
		return
	}
	defer tx.Rollback()
	book, err := scanLibraryBook(tx.QueryRow(`SELECT `+libraryBookColumns+` FROM library_books WHERE id=?`, r.PathValue("id")))
	if libraryReadError(w, err) {
		return
	}
	if book.DraftRevision != payload.ExpectedRevision {
		writeError(w, http.StatusConflict, "draft changed; reload before publishing")
		return
	}
	content := book.Draft
	if rollback {
		var raw string
		err := tx.QueryRow(`SELECT content_json FROM library_releases WHERE book_id=? AND version=?`, book.ID, payload.Version).Scan(&raw)
		if libraryReadError(w, err) {
			return
		}
		if libraryReadError(w, json.Unmarshal([]byte(raw), &content)) {
			return
		}
		payload.Note = fmt.Sprintf("Rollback to v%d", payload.Version) + libraryNoteSuffix(payload.Note)
	}
	validation := validateLibraryContent(content)
	if !validation.Valid {
		writeJSON(w, http.StatusUnprocessableEntity, apiResponse{Success: false, Code: http.StatusUnprocessableEntity, Message: "library content is not ready to publish", Data: validation})
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	version := book.PublishedVersion + 1
	raw, _ := json.Marshal(content)
	_, err = tx.Exec(`INSERT INTO library_releases(book_id,version,content_json,note,created_by,created_at) VALUES(?,?,?,?,?,?)`, book.ID, version, string(raw), payload.Note, user.ID, now)
	if err == nil {
		_, err = tx.Exec(`UPDATE library_books SET draft_json=?,draft_revision=draft_revision+1,published_version=?,updated_at=? WHERE id=?`, string(raw), version, now, book.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to publish library book")
		return
	}
	libraryJSON(w, http.StatusOK, libraryRelease{ID: book.ID, Version: version, Content: content, UpdatedAt: now})
}

func libraryNoteSuffix(note string) string {
	if strings.TrimSpace(note) == "" {
		return ""
	}
	return ": " + strings.TrimSpace(note)
}

func (s *server) libraryBooks(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	rows, err := s.db.Query(`SELECT b.id,r.version,r.content_json,r.created_at FROM library_books b JOIN library_releases r ON r.book_id=b.id AND r.version=b.published_version ORDER BY json_extract(r.content_json,'$.sortOrder'),json_extract(r.content_json,'$.name'),b.id`)
	if libraryReadError(w, err) {
		return
	}
	defer rows.Close()
	books := []librarySummary{}
	for rows.Next() {
		var release libraryRelease
		var raw string
		if libraryReadError(w, rows.Scan(&release.ID, &release.Version, &raw, &release.UpdatedAt)) {
			return
		}
		if libraryReadError(w, json.Unmarshal([]byte(raw), &release.Content)) {
			return
		}
		c := release.Content
		books = append(books, librarySummary{ID: release.ID, Name: c.Name, Description: c.Description, Language: c.Language, TranslateLanguage: c.TranslateLanguage, Category: c.Category, Tags: c.Tags, Recommended: c.Recommended, SortOrder: c.SortOrder, Cover: c.Cover, Length: len(c.Words), Version: release.Version, UpdatedAt: release.UpdatedAt})
	}
	if !libraryReadError(w, rows.Err()) {
		libraryJSON(w, http.StatusOK, books)
	}
}

func (s *server) libraryBook(w http.ResponseWriter, r *http.Request) {
	var version int64
	if value, supplied := r.URL.Query()["version"]; supplied {
		var err error
		if len(value) != 1 {
			writeError(w, http.StatusBadRequest, "version must be a positive integer")
			return
		}
		version, err = strconv.ParseInt(value[0], 10, 64)
		if err != nil || version < 1 {
			writeError(w, http.StatusBadRequest, "version must be a positive integer")
			return
		}
	}
	s.libraryWriteRelease(w, r, r.PathValue("id"), version, true)
}

func (s *server) libraryAdminRelease(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	version, err := strconv.ParseInt(r.PathValue("version"), 10, 64)
	if err != nil || version < 1 {
		writeError(w, http.StatusBadRequest, "version must be a positive integer")
		return
	}
	s.libraryWriteRelease(w, r, r.PathValue("id"), version, false)
}

func (s *server) libraryWriteRelease(w http.ResponseWriter, r *http.Request, id string, version int64, public bool) {
	var release libraryRelease
	var raw string
	query := `SELECT book_id,version,content_json,created_at FROM library_releases WHERE book_id=? AND version=?`
	if version == 0 {
		query = `SELECT r.book_id,r.version,r.content_json,r.created_at FROM library_books b JOIN library_releases r ON r.book_id=b.id AND r.version=b.published_version WHERE b.id=? AND ?=0`
	}
	err := s.db.QueryRow(query, id, version).Scan(&release.ID, &release.Version, &raw, &release.UpdatedAt)
	if libraryReadError(w, err) || libraryReadError(w, json.Unmarshal([]byte(raw), &release.Content)) {
		return
	}
	if public {
		etag := fmt.Sprintf(`"%s-v%d"`, release.ID, release.Version)
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "no-cache")
		if version > 0 {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	libraryJSON(w, http.StatusOK, release)
}

func (s *server) libraryReleases(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	var found string
	if libraryReadError(w, s.db.QueryRow(`SELECT id FROM library_books WHERE id=?`, r.PathValue("id")).Scan(&found)) {
		return
	}
	rows, err := s.db.Query(`SELECT version,note,created_at,created_by FROM library_releases WHERE book_id=? ORDER BY version DESC`, found)
	if libraryReadError(w, err) {
		return
	}
	defer rows.Close()
	releases := []libraryReleaseInfo{}
	for rows.Next() {
		var item libraryReleaseInfo
		if libraryReadError(w, rows.Scan(&item.Version, &item.Note, &item.UpdatedAt, &item.CreatedBy)) {
			return
		}
		releases = append(releases, item)
	}
	if !libraryReadError(w, rows.Err()) {
		libraryJSON(w, http.StatusOK, releases)
	}
}

func (s *server) libraryCreateFeedback(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	w.Header().Set("Cache-Control", "no-store")
	var payload struct {
		Version int64  `json:"version"`
		Word    string `json:"word"`
		Kind    string `json:"kind"`
		Message string `json:"message"`
	}
	if !decodeLibraryJSON(w, r, &payload, false) {
		return
	}
	payload.Message = strings.TrimSpace(payload.Message)
	payload.Word = strings.TrimSpace(payload.Word)
	kinds := map[string]bool{"content": true, "translation": true, "phonetic": true, "sentence": true, "unit": true, "other": true}
	if payload.Version < 1 || !kinds[payload.Kind] || payload.Message == "" || len(payload.Message) > 4000 || len(payload.Word) > 512 {
		writeError(w, http.StatusBadRequest, "feedback requires a version, valid kind, and a message of 1-4000 bytes")
		return
	}
	var raw string
	if libraryReadError(w, s.db.QueryRow(`SELECT content_json FROM library_releases WHERE book_id=? AND version=?`, r.PathValue("id"), payload.Version).Scan(&raw)) {
		return
	}
	var content libraryContent
	if libraryReadError(w, json.Unmarshal([]byte(raw), &content)) {
		return
	}
	if payload.Word != "" {
		found := false
		for _, word := range content.Words {
			if normalizeLibraryWord(word.Word) == normalizeLibraryWord(payload.Word) {
				payload.Word = word.Word
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusBadRequest, "feedback word is absent from this published version")
			return
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	item := libraryFeedback{BookID: r.PathValue("id"), BookName: content.Name, Version: payload.Version, Word: payload.Word, Kind: payload.Kind, Message: payload.Message, UserID: user.ID, Status: "open", CreatedAt: now, UpdatedAt: now}
	result, err := s.db.Exec(`INSERT INTO library_feedback(book_id,version,word,kind,message,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, item.BookID, item.Version, item.Word, item.Kind, item.Message, item.UserID, now, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to save feedback")
		return
	}
	item.ID, _ = result.LastInsertId()
	libraryJSON(w, http.StatusCreated, item)
}

func (s *server) libraryOwnFeedback(w http.ResponseWriter, r *http.Request, user userView, _ string) {
	s.libraryListFeedback(w, r, user.ID)
}

func (s *server) libraryAllFeedback(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	s.libraryListFeedback(w, r, 0)
}

const libraryFeedbackColumns = `f.id,f.book_id,json_extract(r.content_json,'$.name'),f.version,f.word,f.kind,f.message,f.user_id,f.status,f.reply,f.created_at,f.updated_at`

func scanLibraryFeedback(row libraryScanner) (libraryFeedback, error) {
	var item libraryFeedback
	err := row.Scan(&item.ID, &item.BookID, &item.BookName, &item.Version, &item.Word, &item.Kind, &item.Message, &item.UserID, &item.Status, &item.Reply, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func validLibraryFeedbackStatus(status string) bool {
	return status == "open" || status == "resolved" || status == "dismissed"
}

func (s *server) libraryListFeedback(w http.ResponseWriter, r *http.Request, userID int64) {
	w.Header().Set("Cache-Control", "no-store")
	limit, offset := 50, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 200 {
			writeError(w, http.StatusBadRequest, "limit must be 1-200")
			return
		}
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			writeError(w, http.StatusBadRequest, "offset must be non-negative")
			return
		}
	}
	where := []string{"1=1"}
	args := []interface{}{}
	if userID > 0 {
		where = append(where, "f.user_id=?")
		args = append(args, userID)
	}
	if status := r.URL.Query().Get("status"); status != "" {
		if !validLibraryFeedbackStatus(status) {
			writeError(w, http.StatusBadRequest, "invalid feedback status")
			return
		}
		where = append(where, "f.status=?")
		args = append(args, status)
	}
	if bookID := r.URL.Query().Get("bookId"); bookID != "" {
		where = append(where, "f.book_id=?")
		args = append(args, bookID)
	}
	clause := strings.Join(where, " AND ")
	var total int
	if libraryReadError(w, s.db.QueryRow(`SELECT COUNT(*) FROM library_feedback f WHERE `+clause, args...).Scan(&total)) {
		return
	}
	args = append(args, limit, offset)
	rows, err := s.db.Query(`SELECT `+libraryFeedbackColumns+` FROM library_feedback f JOIN library_releases r ON r.book_id=f.book_id AND r.version=f.version WHERE `+clause+` ORDER BY f.id DESC LIMIT ? OFFSET ?`, args...)
	if libraryReadError(w, err) {
		return
	}
	defer rows.Close()
	items := []libraryFeedback{}
	for rows.Next() {
		item, err := scanLibraryFeedback(rows)
		if libraryReadError(w, err) {
			return
		}
		items = append(items, item)
	}
	if !libraryReadError(w, rows.Err()) {
		libraryJSON(w, http.StatusOK, map[string]interface{}{"items": items, "total": total, "limit": limit, "offset": offset})
	}
}

func (s *server) libraryUpdateFeedback(w http.ResponseWriter, r *http.Request, _ userView, _ string) {
	var payload struct {
		Status string  `json:"status"`
		Reply  *string `json:"reply"`
	}
	if !decodeLibraryJSON(w, r, &payload, false) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 || !validLibraryFeedbackStatus(payload.Status) || (payload.Reply != nil && len(*payload.Reply) > 4000) {
		writeError(w, http.StatusBadRequest, "invalid feedback ID, status or reply")
		return
	}
	var reply interface{}
	if payload.Reply != nil {
		reply = strings.TrimSpace(*payload.Reply)
	}
	_, err = s.db.Exec(`UPDATE library_feedback SET status=?,reply=COALESCE(?,reply),updated_at=? WHERE id=?`, payload.Status, reply, time.Now().UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unable to update feedback")
		return
	}
	item, err := scanLibraryFeedback(s.db.QueryRow(`SELECT `+libraryFeedbackColumns+` FROM library_feedback f JOIN library_releases r ON r.book_id=f.book_id AND r.version=f.version WHERE f.id=?`, id))
	if !libraryReadError(w, err) {
		libraryJSON(w, http.StatusOK, item)
	}
}
