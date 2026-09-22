# TypeWords Plus

基于 [zyronon/TypeWords](https://github.com/zyronon/TypeWords) 独立维护的单词与文章练习项目。本仓库的功能规划、账号服务、发布和反馈独立于上游。

- 网站：[hanson07101.top](https://hanson07101.top)
- 源码：[Hanosn2007/TypeWords-plus](https://github.com/Hanosn2007/TypeWords-plus)
- 问题与建议：[本仓库 Issues](https://github.com/Hanosn2007/TypeWords-plus/issues)

## 当前能力

- 个人词书导入、共享书库与管理员发布；共享内容和个人学习进度分离。
- 按词书和单元保存学习任务，可查看单元词表，按单元或按数量安排新词。
- FSRS 间隔复习；同书到期复习与单元重练区分处理。
- 正式学习与自由练习独立续学，自由练习不推进正式进度或 FSRS。
- 浏览器本机保存与本站账号同步；失焦/隐藏时同步，冲突由用户核对，服务端校验版本并支持历史记录。
- 保留文章练习及导入入口。

## 已知边界

主维护目标是 Web 版本。VS Code 等历史平台代码暂时保留，不代表与 Web 功能全部同步验收。部分词典、语音和辅助资源仍依赖外部服务；尚未完成资源自托管或完整离线能力。

移动端软键盘、物理多设备、长期离线及缩放交互持续验收。类型检查仍有既有诊断，不能把构建通过等同于全仓类型检查通过。定时服务器/Mac 双机备份提供实现但默认关闭。

## 开发与检查

使用 pnpm workspace；Web 为 Nuxt/Vue，共享学习模块位于 packages/core，账号与同步服务位于 server（Go/SQLite）。

```sh
pnpm install
pnpm dev
pnpm test:core
pnpm test:server
pnpm typecheck
pnpm build:web
```

build:web 只生成静态产物，不自动部署。部署和数据迁移前应备份当前浏览器及服务器数据；Git 标签保存源码历史，不是学习数据库备份。旧代码重新上线前须检查数据格式兼容。

参见 [单元学习验收](docs/UNIT_REFACTOR_ACCEPTANCE.md)、[重构边界](docs/LEARNING_REFACTOR.md)、[词书导入格式](UNIT_BOOK_FORMAT.md)。

## 上游与许可证

感谢 TypeWords 原作者及贡献者。本项目保留原有 Git 历史、署名与 [GPL-3.0 许可证](LICENSE)。[原始 README](docs/UPSTREAM_README.md) 和其他语言的旧说明作为上游历史资料保留，不能据此判断本站的功能、账号、反馈或部署方式。上游更新按需要审阅引入，不自动覆盖本站定制。
