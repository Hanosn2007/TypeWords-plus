package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type libraryTestBook struct {
	ID               string         `json:"id"`
	Draft            map[string]any `json:"draft"`
	DraftRevision    int64          `json:"draftRevision"`
	PublishedVersion int64          `json:"publishedVersion"`
}

type libraryTestRelease struct {
	ID      string         `json:"id"`
	Version int64          `json:"version"`
	Content map[string]any `json:"content"`
}

type libraryTestFeedbackPage struct {
	Items  []map[string]any `json:"items"`
	Total  int              `json:"total"`
	Limit  int              `json:"limit"`
	Offset int              `json:"offset"`
}

func libraryTestContent(name string) map[string]any {
	return map[string]any{
		"name": name, "description": "测试词书", "language": "en", "translateLanguage": "zh-CN",
		"category": "test", "tags": []string{"classroom"}, "recommended": true, "sortOrder": 10,
		"words": []map[string]any{{
			"word": "apple", "phonetic0": "/ˈæpəl/", "phonetic1": "/ˈæpəl/",
			"trans":     []map[string]any{{"pos": "n.", "cn": "苹果"}},
			"sentences": []map[string]any{{"c": "An apple a day.", "cn": "每天一个苹果。"}},
			"phrases":   []map[string]any{{"c": "apple tree", "cn": "苹果树"}},
			"synos":     []map[string]any{},
			"relWords":  map[string]any{"root": "", "rels": []any{}},
			"etymology": []map[string]any{{"t": "来源", "d": "Old English"}},
		}},
		"units": []map[string]any{{"id": "lesson-1", "name": "第一课", "words": []string{"apple"}}},
	}
}

func libraryTestStatus(t *testing.T, rec *httptest.ResponseRecorder, status int) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d: %s", rec.Code, status, rec.Body.String())
	}
}

func libraryTestRejected(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected validation rejection, got %d: %s", rec.Code, rec.Body.String())
	}
	var response apiResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || response.Success {
		t.Fatalf("invalid error envelope: %s (decode error %v)", rec.Body.String(), err)
	}
}

func libraryTestAdmin(t *testing.T) (*server, *http.ServeMux, authView) {
	t.Helper()
	s, mux := newTestServer(t)
	admin := registerTestUser(t, mux, "admin@example.com")
	s.adminUserIDs = map[int64]bool{admin.User.ID: true}
	return s, mux, admin
}

func libraryTestCreate(t *testing.T, mux http.Handler, token string, content map[string]any) libraryTestBook {
	t.Helper()
	rec := requestJSON(t, mux, http.MethodPost, "/api/admin/library/books", token, map[string]any{"content": content})
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	book := decodeResponse[libraryTestBook](t, rec)
	if !strings.HasPrefix(book.ID, "library-") || book.DraftRevision < 1 || book.PublishedVersion != 0 {
		t.Fatalf("invalid new draft: %+v", book)
	}
	return book
}

func libraryTestGetAdminBook(t *testing.T, mux http.Handler, token, id string) libraryTestBook {
	t.Helper()
	rec := requestJSON(t, mux, http.MethodGet, "/api/admin/library/books/"+id, token, nil)
	libraryTestStatus(t, rec, http.StatusOK)
	return decodeResponse[libraryTestBook](t, rec)
}

func libraryTestPublish(t *testing.T, mux http.Handler, token, id string) libraryTestRelease {
	t.Helper()
	book := libraryTestGetAdminBook(t, mux, token, id)
	rec := requestJSON(t, mux, http.MethodPost, "/api/admin/library/books/"+id+"/publish", token,
		map[string]any{"expectedRevision": book.DraftRevision, "note": "发布说明"})
	libraryTestStatus(t, rec, http.StatusOK)
	return decodeResponse[libraryTestRelease](t, rec)
}

func TestLibraryAdministratorConfigurationRejectsInvalidOrMissingAccounts(t *testing.T) {
	s, mux := newTestServer(t)
	first := registerTestUser(t, mux, "first@example.com")
	second := registerTestUser(t, mux, "second@example.com")
	for _, raw := range []string{"", "  "} {
		ids, err := configuredAdminUserIDs(s.db, raw)
		if err != nil || len(ids) != 0 {
			t.Fatalf("empty administrator configuration must grant nobody: %v, %v", ids, err)
		}
	}
	ids, err := configuredAdminUserIDs(s.db, fmt.Sprintf(" %d, %d, %d ", first.User.ID, second.User.ID, first.User.ID))
	if err != nil || len(ids) != 2 || !ids[first.User.ID] || !ids[second.User.ID] {
		t.Fatalf("existing user IDs were not loaded: %v, %v", ids, err)
	}
	for _, raw := range []string{"0", "-1", "abc", "1.5", "999999", fmt.Sprintf("%d,", first.User.ID), fmt.Sprintf("%d,,%d", first.User.ID, second.User.ID)} {
		if _, err := configuredAdminUserIDs(s.db, raw); err == nil {
			t.Errorf("invalid administrator configuration %q was accepted", raw)
		}
	}
}

func TestLibraryAdminAuthorizationAndDraftIsolation(t *testing.T) {
	s, mux := newTestServer(t)
	first := registerTestUser(t, mux, "first@example.com")
	second := registerTestUser(t, mux, "second@example.com")
	libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, "/api/admin/library/books", "", nil), http.StatusUnauthorized)
	for _, token := range []string{first.Token, second.Token} {
		libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, "/api/admin/library/books", token, nil), http.StatusForbidden)
		libraryTestStatus(t, requestJSON(t, mux, http.MethodPost, "/api/admin/library/books", token, map[string]any{}), http.StatusForbidden)
	}

	s.adminUserIDs = map[int64]bool{second.User.ID: true}
	book := libraryTestCreate(t, mux, second.Token, libraryTestContent("private draft"))
	list := decodeResponse[[]map[string]any](t, requestJSON(t, mux, http.MethodGet, "/api/library/books", "", nil))
	if len(list) != 0 {
		t.Fatalf("draft leaked into public catalog: %+v", list)
	}
	for _, path := range []string{"/api/library/books/" + book.ID, "/api/library/books/" + book.ID + "?version=1"} {
		libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, path, "", nil), http.StatusNotFound)
	}
	for _, endpoint := range []struct{ method, suffix string }{
		{http.MethodGet, ""}, {http.MethodPut, "/draft"}, {http.MethodPost, "/validate"},
		{http.MethodPost, "/publish"}, {http.MethodPost, "/rollback"},
		{http.MethodGet, "/releases"}, {http.MethodGet, "/releases/1"},
	} {
		path := "/api/admin/library/books/" + book.ID + endpoint.suffix
		libraryTestStatus(t, requestJSON(t, mux, endpoint.method, path, first.Token, map[string]any{}), http.StatusForbidden)
	}
	adminBooks := decodeResponse[[]libraryTestBook](t, requestJSON(t, mux, http.MethodGet, "/api/admin/library/books", second.Token, nil))
	if len(adminBooks) != 1 || adminBooks[0].ID != book.ID {
		t.Fatalf("administrator cannot find draft: %+v", adminBooks)
	}
	delete(s.adminUserIDs, second.User.ID)
	libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, "/api/admin/library/books/"+book.ID, second.Token, nil), http.StatusForbidden)
}

func TestLibraryDraftCASAndPublishRechecksRevision(t *testing.T) {
	_, mux, admin := libraryTestAdmin(t)
	book := libraryTestCreate(t, mux, admin.Token, libraryTestContent("original"))
	path := "/api/admin/library/books/" + book.ID
	updated := libraryTestContent("saved edit")
	rec := requestJSON(t, mux, http.MethodPut, path+"/draft", admin.Token,
		map[string]any{"expectedRevision": book.DraftRevision, "content": updated})
	libraryTestStatus(t, rec, http.StatusOK)
	after := libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
	if after.DraftRevision != book.DraftRevision+1 || after.Draft["name"] != "saved edit" {
		t.Fatalf("draft did not advance exactly once: %+v", after)
	}
	for _, endpoint := range []struct{ method, suffix string }{{http.MethodPut, "/draft"}, {http.MethodPost, "/publish"}} {
		payload := map[string]any{"expectedRevision": book.DraftRevision}
		if endpoint.suffix == "/draft" {
			payload["content"] = libraryTestContent("stale overwrite")
		}
		rec = requestJSON(t, mux, endpoint.method, path+endpoint.suffix, admin.Token, payload)
		libraryTestStatus(t, rec, http.StatusConflict)
	}
	afterConflict := libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
	if afterConflict.DraftRevision != after.DraftRevision || afterConflict.Draft["name"] != "saved edit" || afterConflict.PublishedVersion != 0 {
		t.Fatalf("conflict changed stored draft: %+v", afterConflict)
	}
	preview := requestJSON(t, mux, http.MethodPost, path+"/validate", admin.Token,
		map[string]any{"content": libraryTestContent("unsaved preview")})
	libraryTestStatus(t, preview, http.StatusOK)
	if !decodeResponse[struct {
		Valid bool `json:"valid"`
	}](t, preview).Valid {
		t.Fatalf("valid candidate failed validation: %s", preview.Body.String())
	}
	stored := libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
	if stored.Draft["name"] != "saved edit" || stored.DraftRevision != after.DraftRevision {
		t.Fatalf("validation persisted an unsaved candidate: %+v", stored)
	}
	published := libraryTestPublish(t, mux, admin.Token, book.ID)
	if published.Version != 1 || published.Content["name"] != "saved edit" {
		t.Fatalf("unexpected published draft: %+v", published)
	}
}

func TestLibraryValidationBlocksIncompleteAndInvalidReleases(t *testing.T) {
	_, mux, admin := libraryTestAdmin(t)
	empty := requestJSON(t, mux, http.MethodPost, "/api/admin/library/books", admin.Token, map[string]any{})
	if empty.Code != http.StatusOK && empty.Code != http.StatusCreated {
		t.Fatalf("empty draft creation failed: %s", empty.Body.String())
	}
	emptyBook := decodeResponse[libraryTestBook](t, empty)
	libraryTestRejected(t, requestJSON(t, mux, http.MethodPost, "/api/admin/library/books/"+emptyBook.ID+"/publish", admin.Token,
		map[string]any{"expectedRevision": emptyBook.DraftRevision}))

	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"missing name", func(c map[string]any) { c["name"] = "  " }},
		{"empty words", func(c map[string]any) { c["words"] = []any{} }},
		{"blank word", func(c map[string]any) { c["words"].([]map[string]any)[0]["word"] = " " }},
		{"normalized duplicate", func(c map[string]any) {
			c["words"] = append(c["words"].([]map[string]any), map[string]any{"word": " APPLE ", "trans": []map[string]any{{"cn": "苹果"}}})
		}},
		{"missing translation", func(c map[string]any) { c["words"].([]map[string]any)[0]["trans"] = []any{} }},
		{"blank translation", func(c map[string]any) { c["words"].([]map[string]any)[0]["trans"] = []map[string]any{{"cn": "  "}} }},
		{"duplicate unit id", func(c map[string]any) {
			c["units"] = append(c["units"].([]map[string]any), map[string]any{"id": "lesson-1", "name": "第二课", "words": []string{"apple"}})
		}},
		{"missing unit member", func(c map[string]any) { c["units"].([]map[string]any)[0]["words"] = []string{"missing"} }},
		{"duplicate unit member", func(c map[string]any) { c["units"].([]map[string]any)[0]["words"] = []string{"apple", " APPLE "} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			content := libraryTestContent(tc.name)
			tc.mutate(content)
			book := libraryTestCreate(t, mux, admin.Token, content)
			path := "/api/admin/library/books/" + book.ID
			validation := requestJSON(t, mux, http.MethodPost, path+"/validate", admin.Token, map[string]any{})
			libraryTestStatus(t, validation, http.StatusOK)
			result := decodeResponse[struct {
				Valid  bool                             `json:"valid"`
				Errors []struct{ Path, Message string } `json:"errors"`
			}](t, validation)
			if result.Valid || len(result.Errors) == 0 || result.Errors[0].Path == "" || result.Errors[0].Message == "" {
				t.Fatalf("expected actionable validation errors: %s", validation.Body.String())
			}
			libraryTestRejected(t, requestJSON(t, mux, http.MethodPost, path+"/publish", admin.Token,
				map[string]any{"expectedRevision": book.DraftRevision}))
			stored := libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
			if stored.PublishedVersion != 0 || stored.DraftRevision != book.DraftRevision {
				t.Fatalf("failed publish mutated draft state: %+v", stored)
			}
			libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, "/api/library/books/"+book.ID, "", nil), http.StatusNotFound)
		})
	}
	catalog := decodeResponse[[]map[string]any](t, requestJSON(t, mux, http.MethodGet, "/api/library/books", "", nil))
	if len(catalog) != 0 {
		t.Fatalf("invalid drafts leaked into catalog: %+v", catalog)
	}
}

func TestLibraryImmutableHistoryAndRollbackPublishesNewVersion(t *testing.T) {
	_, mux, admin := libraryTestAdmin(t)
	book := libraryTestCreate(t, mux, admin.Token, libraryTestContent("version one"))
	first := libraryTestPublish(t, mux, admin.Token, book.ID)
	publicPath := "/api/library/books/" + book.ID
	adminPath := "/api/admin/library/books/" + book.ID
	firstResponse := requestJSON(t, mux, http.MethodGet, publicPath+"?version=1", "", nil)
	firstPublic := decodeResponse[libraryTestRelease](t, firstResponse)
	if first.Version != 1 || !reflect.DeepEqual(first.Content, firstPublic.Content) {
		t.Fatalf("public content differs from published content: %+v", firstPublic)
	}
	etag := firstResponse.Header().Get("ETag")
	if etag == "" || !strings.Contains(firstResponse.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("versioned snapshot lacks ETag/immutable caching: %+v", firstResponse.Header())
	}
	conditional := httptest.NewRequest(http.MethodGet, publicPath+"?version=1", nil)
	conditional.Header.Set("If-None-Match", etag)
	notModified := httptest.NewRecorder()
	mux.ServeHTTP(notModified, conditional)
	libraryTestStatus(t, notModified, http.StatusNotModified)
	if notModified.Body.Len() != 0 {
		t.Fatal("304 response must not contain a body")
	}
	words := firstPublic.Content["words"].([]any)
	if words[0].(map[string]any)["sentences"].([]any)[0].(map[string]any)["cn"] != "每天一个苹果。" {
		t.Fatal("rich word content was lost during publication")
	}
	current := libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
	content := libraryTestContent("version two")
	content["description"] = "新版"
	libraryTestStatus(t, requestJSON(t, mux, http.MethodPut, adminPath+"/draft", admin.Token,
		map[string]any{"expectedRevision": current.DraftRevision, "content": content}), http.StatusOK)
	latestResponse := requestJSON(t, mux, http.MethodGet, publicPath, "", nil)
	stillFirst := decodeResponse[libraryTestRelease](t, latestResponse)
	if stillFirst.Version != 1 || !reflect.DeepEqual(stillFirst.Content, first.Content) {
		t.Fatal("editing a draft changed the public release")
	}
	if strings.Contains(latestResponse.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("latest-release URL must be revalidated rather than cached permanently")
	}
	second := libraryTestPublish(t, mux, admin.Token, book.ID)
	if second.Version != 2 || second.Content["name"] != "version two" {
		t.Fatalf("unexpected second release: %+v", second)
	}
	conditional = httptest.NewRequest(http.MethodGet, publicPath, nil)
	conditional.Header.Set("If-None-Match", etag)
	changed := httptest.NewRecorder()
	mux.ServeHTTP(changed, conditional)
	libraryTestStatus(t, changed, http.StatusOK)
	if changed.Header().Get("ETag") == etag {
		t.Fatal("new publication retained the old ETag")
	}
	current = libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
	libraryTestStatus(t, requestJSON(t, mux, http.MethodPost, adminPath+"/rollback", admin.Token,
		map[string]any{"expectedRevision": current.DraftRevision - 1, "version": 1}), http.StatusConflict)
	rolled := requestJSON(t, mux, http.MethodPost, adminPath+"/rollback", admin.Token,
		map[string]any{"expectedRevision": current.DraftRevision, "version": 1, "note": "恢复第一版"})
	libraryTestStatus(t, rolled, http.StatusOK)
	third := decodeResponse[libraryTestRelease](t, rolled)
	if third.Version != 3 || !reflect.DeepEqual(third.Content, first.Content) {
		t.Fatalf("rollback must copy old content into version 3: %+v", third)
	}
	for _, release := range []libraryTestRelease{first, second, third} {
		suffix := fmt.Sprintf("?version=%d", release.Version)
		stored := decodeResponse[libraryTestRelease](t, requestJSON(t, mux, http.MethodGet, publicPath+suffix, "", nil))
		if stored.Version != release.Version || !reflect.DeepEqual(stored.Content, release.Content) {
			t.Fatalf("version %d was changed: %+v", release.Version, stored)
		}
		preview := decodeResponse[libraryTestRelease](t, requestJSON(t, mux, http.MethodGet,
			fmt.Sprintf("%s/releases/%d", adminPath, release.Version), admin.Token, nil))
		if !reflect.DeepEqual(preview.Content, release.Content) {
			t.Fatalf("admin preview differs for version %d", release.Version)
		}
	}
	latest := decodeResponse[libraryTestRelease](t, requestJSON(t, mux, http.MethodGet, publicPath, "", nil))
	if latest.Version != 3 {
		t.Fatalf("current release = %d after rollback", latest.Version)
	}
	history := decodeResponse[[]map[string]any](t, requestJSON(t, mux, http.MethodGet, adminPath+"/releases", admin.Token, nil))
	if len(history) != 3 {
		t.Fatalf("release history length = %d, want 3", len(history))
	}
	catalog := decodeResponse[[]map[string]any](t, requestJSON(t, mux, http.MethodGet, "/api/library/books", "", nil))
	if len(catalog) != 1 || catalog[0]["version"] != float64(3) || catalog[0]["length"] != float64(1) || catalog[0]["name"] != "version one" {
		t.Fatalf("catalog does not match latest release: %+v", catalog)
	}
	for _, invalid := range []string{"0", "-1", "invalid"} {
		libraryTestRejected(t, requestJSON(t, mux, http.MethodGet, publicPath+"?version="+invalid, "", nil))
	}
	libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, publicPath+"?version=999", "", nil), http.StatusNotFound)
}

func TestLibraryFeedbackRequiresRealPublishedVersionAndWord(t *testing.T) {
	_, mux, admin := libraryTestAdmin(t)
	student := registerTestUser(t, mux, "student@example.com")
	book := libraryTestCreate(t, mux, admin.Token, libraryTestContent("feedback"))
	path := "/api/library/books/" + book.ID + "/feedback"
	payload := map[string]any{"version": 1, "word": "apple", "kind": "other", "message": "请核对释义"}
	libraryTestStatus(t, requestJSON(t, mux, http.MethodPost, path, "", payload), http.StatusUnauthorized)
	beforePublish := requestJSON(t, mux, http.MethodPost, path, student.Token, payload)
	if beforePublish.Code != http.StatusNotFound && beforePublish.Code != http.StatusBadRequest {
		t.Fatalf("feedback accepted for draft: %d %s", beforePublish.Code, beforePublish.Body.String())
	}
	libraryTestPublish(t, mux, admin.Token, book.ID)
	for _, tc := range []struct {
		name  string
		key   string
		value any
	}{
		{"unknown version", "version", 99}, {"missing word", "word", "banana"},
		{"empty message", "message", "  "}, {"invalid kind", "kind", "invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := map[string]any{"version": 1, "word": "apple", "kind": "other", "message": "请核对释义"}
			bad[tc.key] = tc.value
			rec := requestJSON(t, mux, http.MethodPost, path, student.Token, bad)
			if rec.Code != http.StatusNotFound {
				libraryTestRejected(t, rec)
			}
		})
	}
	current := libraryTestGetAdminBook(t, mux, admin.Token, book.ID)
	newContent := libraryTestContent("feedback version two")
	newContent["words"].([]map[string]any)[0]["word"] = "banana"
	newContent["units"].([]map[string]any)[0]["words"] = []string{"banana"}
	libraryTestStatus(t, requestJSON(t, mux, http.MethodPut, "/api/admin/library/books/"+book.ID+"/draft", admin.Token,
		map[string]any{"expectedRevision": current.DraftRevision, "content": newContent}), http.StatusOK)
	libraryTestPublish(t, mux, admin.Token, book.ID)
	libraryTestRejected(t, requestJSON(t, mux, http.MethodPost, path, student.Token,
		map[string]any{"version": 2, "word": "apple", "kind": "other", "message": "词条只在旧版存在"}))
	valid := requestJSON(t, mux, http.MethodPost, path, student.Token, payload)
	if valid.Code != http.StatusOK && valid.Code != http.StatusCreated {
		t.Fatalf("valid feedback rejected: %d %s", valid.Code, valid.Body.String())
	}
	page := decodeResponse[libraryTestFeedbackPage](t, requestJSON(t, mux, http.MethodGet, "/api/library/feedback", student.Token, nil))
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0]["message"] != "请核对释义" || page.Items[0]["version"] != float64(1) {
		t.Fatalf("invalid feedback was persisted or valid feedback lost: %+v", page)
	}
}

func TestLibraryFeedbackOwnershipFilteringPaginationAndModeration(t *testing.T) {
	_, mux, admin := libraryTestAdmin(t)
	alice := registerTestUser(t, mux, "alice@example.com")
	bob := registerTestUser(t, mux, "bob@example.com")
	first := libraryTestCreate(t, mux, admin.Token, libraryTestContent("first"))
	second := libraryTestCreate(t, mux, admin.Token, libraryTestContent("second"))
	libraryTestPublish(t, mux, admin.Token, first.ID)
	libraryTestPublish(t, mux, admin.Token, second.ID)
	libraryTestRejected(t, requestJSON(t, mux, http.MethodPost, "/api/library/books/"+first.ID+"/feedback", alice.Token,
		map[string]any{"version": 1, "kind": "other", "message": "spoofed author", "userId": admin.User.ID}))
	feedbackIDs := []string{}
	for i, item := range []struct{ token, bookID, message string }{
		{alice.Token, first.ID, "alice-one"}, {alice.Token, first.ID, "alice-two"},
		{bob.Token, first.ID, "bob-one"}, {alice.Token, second.ID, "alice-other-book"},
	} {
		rec := requestJSON(t, mux, http.MethodPost, "/api/library/books/"+item.bookID+"/feedback", item.token,
			map[string]any{"version": 1, "kind": "other", "message": item.message})
		if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
			t.Fatalf("feedback %d failed: %s", i, rec.Body.String())
		}
		feedback := decodeResponse[map[string]any](t, rec)
		feedbackIDs = append(feedbackIDs, fmt.Sprint(feedback["id"]))
	}
	alicePage := decodeResponse[libraryTestFeedbackPage](t, requestJSON(t, mux, http.MethodGet,
		fmt.Sprintf("/api/library/feedback?userId=%d", bob.User.ID), alice.Token, nil))
	if alicePage.Total != 3 || len(alicePage.Items) != 3 {
		t.Fatalf("unexpected Alice feedback count: %+v", alicePage)
	}
	for _, feedback := range alicePage.Items {
		if !strings.HasPrefix(fmt.Sprint(feedback["message"]), "alice-") {
			t.Fatalf("another user's feedback leaked: %+v", feedback)
		}
	}
	bobPage := decodeResponse[libraryTestFeedbackPage](t, requestJSON(t, mux, http.MethodGet, "/api/library/feedback", bob.Token, nil))
	if bobPage.Total != 1 || len(bobPage.Items) != 1 || bobPage.Items[0]["message"] != "bob-one" {
		t.Fatalf("unexpected Bob feedback: %+v", bobPage)
	}
	libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, "/api/library/feedback", "", nil), http.StatusUnauthorized)
	libraryTestStatus(t, requestJSON(t, mux, http.MethodGet, "/api/admin/library/feedback", alice.Token, nil), http.StatusForbidden)
	patchPath := "/api/admin/library/feedback/" + feedbackIDs[0]
	libraryTestStatus(t, requestJSON(t, mux, http.MethodPatch, patchPath, bob.Token,
		map[string]any{"status": "resolved", "reply": "spoofed"}), http.StatusForbidden)
	libraryTestStatus(t, requestJSON(t, mux, http.MethodPatch, patchPath, admin.Token,
		map[string]any{"status": "resolved", "reply": "已修正"}), http.StatusOK)
	filteredURL := "/api/admin/library/feedback?bookId=" + first.ID + "&status=open&limit=1&offset=1"
	page := decodeResponse[libraryTestFeedbackPage](t, requestJSON(t, mux, http.MethodGet, filteredURL, admin.Token, nil))
	if page.Total != 2 || len(page.Items) != 1 || page.Limit != 1 || page.Offset != 1 || page.Items[0]["status"] != "open" {
		t.Fatalf("filter or pagination is incorrect: %+v", page)
	}
	resolved := decodeResponse[libraryTestFeedbackPage](t, requestJSON(t, mux, http.MethodGet,
		"/api/admin/library/feedback?bookId="+first.ID+"&status=resolved", admin.Token, nil))
	if resolved.Total != 1 || len(resolved.Items) != 1 || resolved.Items[0]["reply"] != "已修正" || resolved.Items[0]["message"] != "alice-one" {
		t.Fatalf("moderation was not persisted: %+v", resolved)
	}
	libraryTestRejected(t, requestJSON(t, mux, http.MethodPatch, patchPath, admin.Token, map[string]any{"status": "invalid"}))
}

func TestLibraryMigrationPreservesExistingAccountSessionAndSyncData(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
		CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
		CREATE TABLE sync_items (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, data TEXT NOT NULL, data_version INTEGER, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, type));
		INSERT INTO users VALUES (7, 'legacy@example.com', 'untouched-password-hash', '2026-01-01T00:00:00Z');
		INSERT INTO sync_items VALUES (7, 'dict', '{"name":"原有个人词书","fsrs":{"apple":{"reps":5}}}', 4, '2026-01-01T00:00:00Z', 17);
	`)
	if err != nil {
		t.Fatal(err)
	}
	token, tokenHash, err := newSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO sessions VALUES (?, 7, '2100-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, tokenHash); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrate(db); err != nil {
			t.Fatalf("migration run %d: %v", i+1, err)
		}
	}
	s := &server{db: db, adminUserIDs: map[int64]bool{7: true}}
	mux := s.routes()
	user := decodeResponse[userView](t, requestJSON(t, mux, http.MethodGet, "/api/auth/me", token, nil))
	if user.ID != 7 || user.Email != "legacy@example.com" {
		t.Fatalf("migration changed account/session: %+v", user)
	}
	book := libraryTestCreate(t, mux, token, libraryTestContent("new shared book"))
	libraryTestPublish(t, mux, token, book.ID)
	rows := decodeResponse[syncSnapshot](t, requestJSON(t, mux, http.MethodGet, "/api/sync/snapshot", token, nil)).Rows
	if len(rows) != 1 || string(rows[0].Data) != `{"name":"原有个人词书","fsrs":{"apple":{"reps":5}}}` || rows[0].Revision != 17 || rows[0].DataVersion == nil || *rows[0].DataVersion != 4 {
		t.Fatalf("migration/library writes changed personal sync data: %+v", rows)
	}
	var hash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id = 7`).Scan(&hash); err != nil || hash != "untouched-password-hash" {
		t.Fatalf("migration changed password hash: %q, %v", hash, err)
	}
}
