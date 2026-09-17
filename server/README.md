# TypeWords API

账号、个人同步和共享词书运行在同一 Go 服务与 SQLite 数据库。新迁移只增加 `library_books`、`library_releases`、`library_feedback` 和相关索引，不改写既有用户、会话或 `sync_items`。本文件是通用操作说明，当前部署状态以项目根目录的`PROJECT_STATE.md`为准。

## 本地启动

在本目录运行 `go run .`。默认监听 `127.0.0.1:8080`，数据库位于 `./data/typewords.db`。从仓库外启动时先切到 `server`；不要使用只编译单文件的 `go run main.go`。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `TYPEWORDS_LISTEN` | `127.0.0.1:8080` | 监听地址 |
| `TYPEWORDS_DATA_DIR` | `./data` | SQLite 数据目录 |
| `ALLOW_REGISTRATION` | `true` | 是否允许注册 |
| `TYPEWORDS_ADMIN_USER_IDS` | 空 | 已注册账号 ID，以英文逗号分隔 |

新环境先在没有管理员配置的情况下启动，注册自己的账号，从登录响应或 `/api/auth/me` 的 `data.id` 确认 ID，再设置白名单并重启。例如，已核对 ID 为 12 时：

```sh
TYPEWORDS_DATA_DIR=./data TYPEWORDS_ADMIN_USER_IDS=12 go run .
```

`12` 仅为示例，必须替换成实际已有 ID。空白配置表示没有管理员，首个注册账号也不会自动成为管理员。格式非法、非正数或不存在的 ID 会让服务启动失败，避免误把管理权留给未来注册者。返回的 `is_admin` 和每个管理请求均按白名单判断；修改后重启服务生效。示例 systemd 文件没有启用实际管理员。

## 草稿、发布与反馈

接口沿用 `{success,code,msg,data}`。公开目录仅包含当前发布内容；`GET /api/library/books/{id}?version=N` 读取不可变历史，带一年 `immutable` 缓存与 ETag。省略版本时需要重新验证，避免把旧内容长期缓存为最新版。

草稿可不完整，保存需 `expectedRevision`；冲突返回 409。发布和回滚都会在事务内重新检查修订号、校验完整内容，并增加发布号和草稿修订号。回滚将旧内容复制成新版本，历史记录继续可读。管理页面应在发布、回滚后重新读取草稿；`hasUnpublishedChanges` 表示草稿内容是否不同于当前发布内容。

发布错误返回 422，`data.errors` 和 `data.warnings` 各含 `{path,message}`。单独校验接口总是返回 200 和 `data.valid`，可校验存储草稿或请求中的临时内容；临时校验不会保存。

请求上限 32 MiB，最多 50,000 个词、2,000 个单元、200,000 个单元成员和 50 个标签。发布要求词书有效、词条非空且规范化后唯一、每词有效释义、单元 ID 唯一且引用真实词条。单元间可重复出现同一词，同一单元内不能重复。没有单元也可发布；有单元但尚未分配的词给出提示，仍可整书学习。

学生登录后提交并查看本人反馈，反馈绑定真实发布版本和可选词条。类别为 `content`、`translation`、`phonetic`、`sentence`、`unit`、`other`，状态为 `open`、`resolved`、`dismissed`。列表响应是 `{items,total,limit,offset}`，默认 50 条、最多 200 条，支持 `status` 和 `bookId` 筛选。管理员回复不会自动发布草稿。

## 验证与部署准备

```sh
go test ./...
go vet ./...
go build -o /tmp/typewords-api-local .
```

生产部署需另行授权。部署前对当前 SQLite 做在线备份并执行 `PRAGMA integrity_check`，同时保留旧服务二进制与前端版本；先在独立恢复副本验证新迁移。不要直接复制运行中数据库而遗漏 WAL，也不要用空数据库替换现有生产库。词书内容回滚通过管理 API 生成新发布版本；服务程序回退使用保留的旧二进制，新增词库表可继续保留。只有需要恢复整库且已核对备份之后产生的用户数据时，才考虑数据库恢复。
