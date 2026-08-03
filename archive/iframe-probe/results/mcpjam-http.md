# MCPJam Inspector / Streamable HTTP

## 環境

| 項目 | 値 |
|---|---|
| ホスト名 / バージョン | MCPJam Inspector 2.32.0（`npx @mcpjam/inspector@latest`） |
| トランスポート | http（`http://127.0.0.1:3000/mcp`） |
| OS | Windows 11 Home / Chromium 150（Playwright 経由） |
| 検証日 (YYYYMMDD) | 20260802 |
| サーバー版数 | mcp-apps-iframe-probe 0.1.0（commit bc7be57） |
| `hostInfo.name` / `version`（パネル A より） | `mcpjam-inspector` / `2.32.0` |
| `protocolVersion` | `2026-01-26` |
| クライアントの ui capability（サーバー stderr ログ） | `{"mimeTypes":["text/html;profile=mcp-app"]}` |

補足: `hostContext.availableDisplayModes` は `["inline","fullscreen","pip"]`、platform は `web`。

## 結果

| プローブ | frameDomains 承認 | iframe 読込 | viz 描画 | 操作可能 |
|---|---|---|---|---|
| A（csp なし） | no（承認 csp は `{}`） | **yes** | **yes** | yes（フィルタ UI 表示・目視） |
| C（resourceDomains） | no（承認 csp は `{}`） | yes（img 799×626 デコード確認） | yes | —（静止画） |
| B（frameDomains） | **no（承認 csp は `{}`）** | yes | yes | **yes（ツールチップ実測: "Washington - 98031 / Profit Ratio 44.6%"）** |
| D（両方 / Embedding API） | no（承認 csp は `{}`） | yes（script onload + `<tableau-viz>` 内部 iframe 生成確認） | yes | 観測不可（未操作） |

**この表の読み方に注意。** A が「読込 yes / 描画 yes」なので、このホストは **csp 宣言を無視して埋め込みを許すホスト**。B〜D の「yes」は frameDomains を尊重した結果ではなく、CSP 制限自体が存在しない結果。

## 最重要の観測: 承認 csp `{}` なのにすべて描画される

- `ui/initialize` の `hostCapabilities.sandbox.csp` は全プローブで **`{}`（空）**
- 仕様どおりなら空 = 承認ドメインなし = `frame-src 'none'` で、A も B も白画面になるはず
- 実際には4プローブ全部で Tableau viz がフル描画され、ツールチップまで動く
- CSP 違反イベントは全プローブで 0 件（CSP がそもそも適用されていないことと整合）

つまり MCPJam 2.32.0 は「宣言を承認結果に反映しない」かつ「既定 CSP も強制しない」。**軸1の測定はこのホストでは成立しない**（拒否も承認もされず、素通し）。リファレンス基準値としては「素通しホストのサンプル」として使える。

## sandbox 実測（パネル C）

| 項目 | 値 |
|---|---|
| `window.origin` | `http://localhost:6274`（**opaque ではない**） |
| `document.domain` | `localhost` |
| localStorage | 読み書き成功 |
| sessionStorage | 読み書き成功 |
| document.cookie | 書き込み成功 |
| `crossOriginIsolated` | `false` |

Sandbox proxy iframe の実属性（DOM 実測）: `allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts`。`allow-same-origin` が付いているため View は実 origin を持ち、だからこそ中の Tableau (VizQL の CORS fetch) が動く。偽ホスト実験（allow-same-origin なし→白画面）と対になる観測。

## CSP 違反ログ（パネル E）

```
全プローブで「違反なし」（0件）
```

## visibility の挙動

| 項目 | 結果 |
|---|---|
| `probe_app_only` がモデルの tools/list に見えたか | 観測不可（LLM 未接続のため、モデル視点の tools/list を確認できず） |

Inspector の Tools 一覧には `probe_app_only` が `visibility: ["app"]` バッジ付きで表示される。これは開発者向け一覧であり、モデルの tools/list とは別物。判定は LLM を接続した再測定に持ち越し。

## スクリーンショット

- A: [probe-a-panel.png](screenshots/mcpjam-http/probe-a-panel.png)（診断パネル上部）/ [probe-a-viz.png](screenshots/mcpjam-http/probe-a-viz.png)（viz 描画）
- C: [probe-c-image.png](screenshots/mcpjam-http/probe-c-image.png)
- B: [probe-b-tooltip.png](screenshots/mcpjam-http/probe-b-tooltip.png)（ツールチップ表示中）
- D: [probe-d-embedapi.png](screenshots/mcpjam-http/probe-d-embedapi.png)

## 自由記述

- 仕様との乖離（記録すべき挙動）:
  1. `hostCapabilities.sandbox.csp` が宣言に関係なく常に `{}`。宣言の反映がない
  2. その `{}` にもかかわらず外部 iframe / 画像 / script がすべて通る。「csp を省略した場合のホスト既定値」（MUST）が強制されていない
- 接続直後に MCPJam が4リソースすべてを先読み（`resources/read` ×4）する。listing 側 `_meta.ui` のレビュー用途と思われる
- ツール実行は Playground の Tools ランナーから実施（LLM 非経由）。tool-input 通知は全プローブで受信された
- 計測は Playwright による自動操作。ツールチップ確認（B）はマウスホバーの実測、D の操作可能性は未実施
