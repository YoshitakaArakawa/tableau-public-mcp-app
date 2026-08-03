# 結果サマリ

全ホストの結果を1枚に集約する。手動更新でよい。

各ホストの詳細は `<host>-<transport>.md`（`TEMPLATE.md` のコピー）に置く。

## frameDomains 承認（プローブ B）

| ホスト | トランスポート | 承認 | 読込 | 描画 | 操作 | 詳細 |
|---|---|---|---|---|---|---|
| MCPJam Inspector 2.32.0 | http | no（`{}`） | yes | yes | yes | [mcpjam-http.md](mcpjam-http.md) |
| Claude Desktop (Claude Code) | stdio | **承認するが CSP 未反映** | no（frame-src 違反） | no | no | 記録中（ウィジェット計測は完了、ファイル未作成） |
| ChatGPT Plus | http | 観測不可（CSP オフ表示） | yes | yes | yes | [chatgpt-http.md](chatgpt-http.md)（シンプル版で計測） |
| claude.ai | http | | | | | |
| VS Code | | | | | | |

## 全プローブ横断

| ホスト | A（csp なし） | C（画像） | B（iframe） | D（Embedding API） |
|---|---|---|---|---|
| MCPJam 2.32.0 | 描画 yes ※ | 描画 yes | 描画 yes | 描画 yes |

A が「読込 yes」になっているホストは、csp 宣言を無視して既定より緩い CSP を当てている。その行は他のプローブの解釈も変わるので、注記を付けること。

※ MCPJam は A が成功する = CSP 素通しホスト。B〜D の yes は frameDomains 尊重の証拠にならない。

## 仕様違反として記録したもの

- MCPJam Inspector 2.32.0: `hostCapabilities.sandbox.csp` が宣言に関係なく常に `{}`、かつ既定 CSP（MUST）を強制せず外部 iframe / 画像 / script がすべて通る。詳細は [mcpjam-http.md](mcpjam-http.md)

## 未解決

- MCPJam: `probe_app_only` のモデル視点 tools/list 判定（LLM 未接続のため観測不可）
