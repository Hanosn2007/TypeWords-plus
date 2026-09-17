package main

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const (
	maxLibraryWords       = 50000
	maxLibraryUnits       = 2000
	maxLibraryMemberships = 200000
)

type libraryIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type libraryValidation struct {
	Valid    bool           `json:"valid"`
	Errors   []libraryIssue `json:"errors"`
	Warnings []libraryIssue `json:"warnings"`
}

func normalizeLibraryWord(word string) string {
	return strings.ToLower(strings.TrimSpace(word))
}

// Drafts may be incomplete. Bound their size, and keep native Word collection
// fields as arrays so readers never receive null where the app expects an array.
func prepareLibraryDraft(w http.ResponseWriter, content *libraryContent) bool {
	if len(content.Words) > maxLibraryWords || len(content.Units) > maxLibraryUnits || len(content.Tags) > 50 {
		writeError(w, http.StatusBadRequest, "library draft exceeds word, unit or tag limits")
		return false
	}
	memberships := 0
	for _, unit := range content.Units {
		memberships += len(unit.Words)
	}
	if memberships > maxLibraryMemberships {
		writeError(w, http.StatusBadRequest, "library draft exceeds unit membership limit")
		return false
	}
	if content.Words == nil {
		content.Words = []libraryWord{}
	}
	if content.Units == nil {
		content.Units = []libraryUnit{}
	}
	if content.Tags == nil {
		content.Tags = []string{}
	}
	for i := range content.Units {
		if content.Units[i].Words == nil {
			content.Units[i].Words = []string{}
		}
	}
	for i := range content.Words {
		word := &content.Words[i]
		if word.Trans == nil {
			word.Trans = []libraryTranslation{}
		}
		if word.Sentences == nil {
			word.Sentences = []libraryTextPair{}
		}
		if word.Phrases == nil {
			word.Phrases = []libraryTextPair{}
		}
		if word.Synos == nil {
			word.Synos = []librarySynonym{}
		}
		for j := range word.Synos {
			if word.Synos[j].WS == nil {
				word.Synos[j].WS = []string{}
			}
		}
		if word.RelWords.Rels == nil {
			word.RelWords.Rels = []libraryRelatedWords{}
		}
		for j := range word.RelWords.Rels {
			if word.RelWords.Rels[j].Words == nil {
				word.RelWords.Rels[j].Words = []libraryTextPair{}
			}
		}
		if word.Etymology == nil {
			word.Etymology = []libraryEtymology{}
		}
	}
	return true
}

func validateLibraryContent(content libraryContent) libraryValidation {
	result := libraryValidation{Valid: true, Errors: []libraryIssue{}, Warnings: []libraryIssue{}}
	add := func(path, message string) {
		if len(result.Errors) < 500 {
			result.Errors = append(result.Errors, libraryIssue{path, message})
		}
	}
	warn := func(path, message string) {
		if len(result.Warnings) < 200 {
			result.Warnings = append(result.Warnings, libraryIssue{path, message})
		}
	}
	if strings.TrimSpace(content.Name) == "" || len(content.Name) > 600 {
		add("name", "书名不能为空，且不能超过600字节")
	}
	if len(content.Description) > 60000 {
		add("description", "说明不能超过60000字节")
	}
	if len(content.Category) > 300 {
		add("category", "分类不能超过300字节")
	}
	if content.Language != "en" && content.Language != "ja" && content.Language != "de" && content.Language != "code" {
		add("language", "不支持的词书语言")
	}
	translations := map[string]bool{"en": true, "zh-CN": true, "ja": true, "de": true, "common": true, "": true}
	if !translations[content.TranslateLanguage] {
		add("translateLanguage", "不支持的释义语言")
	}
	if len(content.Tags) > 50 {
		add("tags", "标签不能超过50个")
	}
	for i, tag := range content.Tags {
		if strings.TrimSpace(tag) == "" || len(tag) > 300 {
			add(fmt.Sprintf("tags[%d]", i), "标签不能为空，且不能超过300字节")
		}
	}
	if content.SortOrder < -1000000 || content.SortOrder > 1000000 {
		add("sortOrder", "排序值必须在-1000000至1000000之间")
	}
	if content.Cover != "" {
		u, err := url.Parse(content.Cover)
		if err != nil || len(content.Cover) > 4000 || !((u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil || u.Scheme == "" && u.Host == "" && strings.HasPrefix(content.Cover, "/") && !strings.HasPrefix(content.Cover, "//")) {
			add("cover", "封面必须是HTTP(S)网址或本站绝对路径")
		}
	}
	if len(content.Words) == 0 || len(content.Words) > maxLibraryWords {
		add("words", "词数必须在1至50000之间")
	}
	if len(content.Units) > maxLibraryUnits {
		add("units", "单元不能超过2000个")
	}
	words := map[string]bool{}
	wordIDs := map[string]bool{}
	for i, word := range content.Words {
		path := fmt.Sprintf("words[%d]", i)
		key := normalizeLibraryWord(word.Word)
		if key == "" || len(word.Word) > 512 {
			add(path+".word", "词条不能为空，且不能超过512字节")
		}
		if words[key] {
			add(path+".word", "同书词条重复（忽略首尾空白和大小写）")
		}
		words[key] = true
		if word.ID != "" {
			if wordIDs[word.ID] || len(word.ID) > 128 {
				add(path+".id", "词条ID重复或超过128字节")
			}
			wordIDs[word.ID] = true
		}
		if len(word.Phonetic0) > 2000 || len(word.Phonetic1) > 2000 {
			add(path+".phonetic0", "音标不能超过2000字节")
		}
		if len(word.Trans) == 0 {
			add(path+".trans", "至少需要一条有效释义")
		}
		for j, trans := range word.Trans {
			p := fmt.Sprintf("%s.trans[%d]", path, j)
			if strings.TrimSpace(trans.CN) == "" || len(trans.CN) > 30000 {
				add(p+".cn", "释义不能为空，且不能超过30000字节")
			}
			if len(trans.POS) > 300 {
				add(p+".pos", "词性不能超过300字节")
			}
			if trans.Frequency != nil && (*trans.Frequency < 0 || *trans.Frequency > 2) {
				add(p+".frequency", "词频必须为0、1或2")
			}
		}
		for field, pairs := range map[string][]libraryTextPair{"sentences": word.Sentences, "phrases": word.Phrases} {
			for j, pair := range pairs {
				if strings.TrimSpace(pair.C) == "" {
					add(fmt.Sprintf("%s.%s[%d].c", path, field, j), "原文不能为空")
				}
				if len(pair.C) > 30000 || len(pair.CN) > 30000 {
					add(fmt.Sprintf("%s.%s[%d]", path, field, j), "单条内容不能超过30000字节")
				}
			}
		}
	}
	unitIDs := map[string]bool{}
	assigned := map[string]bool{}
	memberships := 0
	for i, unit := range content.Units {
		path := fmt.Sprintf("units[%d]", i)
		if strings.TrimSpace(unit.ID) == "" || unit.ID != strings.TrimSpace(unit.ID) || len(unit.ID) > 128 {
			add(path+".id", "单元ID不能为空、不能含首尾空白，且不能超过128字节")
		}
		if unitIDs[unit.ID] {
			add(path+".id", "单元ID重复")
		}
		unitIDs[unit.ID] = true
		if strings.TrimSpace(unit.Name) == "" || len(unit.Name) > 600 {
			add(path+".name", "单元名称不能为空，且不能超过600字节")
		}
		if len(unit.Words) == 0 {
			add(path+".words", "单元不能为空")
		}
		members := map[string]bool{}
		memberships += len(unit.Words)
		for j, word := range unit.Words {
			key := normalizeLibraryWord(word)
			p := fmt.Sprintf("%s.words[%d]", path, j)
			if !words[key] {
				add(p, "单元成员不在词书中")
			}
			if members[key] {
				add(p, "同一单元内不能重复添加词条")
			}
			members[key], assigned[key] = true, true
		}
	}
	if memberships > maxLibraryMemberships {
		add("units", "单元成员总数不能超过200000")
	}
	if len(content.Units) > 0 {
		unassigned := 0
		for word := range words {
			if !assigned[word] {
				unassigned++
			}
		}
		if unassigned > 0 {
			warn("units", fmt.Sprintf("%d个词尚未分配单元，仍可在整书范围学习", unassigned))
		}
	}
	result.Valid = len(result.Errors) == 0
	return result
}
