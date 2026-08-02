# mcp-apps-iframe-probe

MCP クライアント（ホスト）が **MCP Apps (SEP-1865)** の入れ子 iframe をどこまでサポートするかを実測する、最小限の MCP サーバー。

測りたいのは2軸。

1. **CSP** — ホストが `_meta.ui.csp.frameDomains` を尊重して `frame-src` を開けるか
2. **sandbox 継承** — iframe の sandbox フラグは入れ子の browsing context に継承される。View の iframe に `allow-same-origin` がなければ、中の外部コンテンツは opaque origin に置かれ、Cookie / localStorage / same-origin fetch が使えない

この2軸を分離して観測できることが、この成果物の価値。「読み込めたか」だけでなく「実際に描画・操作できたか」まで見る。

埋め込みサンプルには Tableau Public の viz を使うが、**Tableau 自体は目的ではない**。認証不要・データソース設定不要でクロスオリジンの重量級 Web アプリを埋め込める素材として選んでいるだけで、VizQL API・拡張機能・フィルタ連携などは一切実装しない。

---

## セットアップ

```bash
npm install && npm run build
```

Node.js 20 以上が必要。

### stdio（デスクトップ系ホスト）

```bash
node dist/index.js --transport stdio
```

### Streamable HTTP（Web ホスト）

```bash
node dist/index.js --transport http --port 3000
```

エンドポイントは `/mcp`。CORS は許可済み。`/health` で稼働確認できる。

セッション管理は stateful（`Mcp-Session-Id` ヘッダ）。capability ネゴシエーションは initialize の1回しか起きないため、stateless にすると「クライアントが何を advertise したか」を取りこぼす。

---

## プローブ設計

1つの HTML に全部詰めると失敗原因が切り分けられない。変数を1つずつ変えた**4つの独立リソース**にしてある。

| ID | resource URI | 宣言する csp | 期待 | 何が分かるか |
|---|---|---|---|---|
| A | `ui://tp/baseline` | **なし** | 失敗 | 既定 CSP が効いているか。成功したら「csp を無視するホスト」 |
| B | `ui://tp/iframe` | `frameDomains` | ? | **本命**。frame-src が開くか |
| C | `ui://tp/image` | `resourceDomains` | ? | 静止画 `.png` 版。外部リソース取得だけなら通るか |
| D | `ui://tp/embedapi` | `resourceDomains` + `frameDomains` | ? | Embedding API v3。外部 script 読込 + script が生成する iframe |

ツールは `show_probe_a` 〜 `show_probe_d` の4本。`_meta.ui.resourceUri` はツール定義時に固定されるので、1ツールで動的に切り替えることはできない。

副産物として `probe_app_only`（`visibility: ["app"]`）を1本置いてある。これがモデルの `tools/list` に見えていたら、そのホストは `visibility` に未対応。

全プローブで `prefersBorder: false`、`permissions` は宣言しない。プローブ間で変わるのは **csp 宣言と埋め込み方式だけ**。

### 埋め込み対象 URL

`https://public.tableau.com/views/DeveloperSuperstore/Overview` に固定。差し替え引数は置いていない。viz の中身は測定対象ではなく、引数にすると URL 検証・正規化・tool-input のタイミングという測定外の変数が増えるため。

- iframe: `?:embed=true&:showVizHome=no` を付与
- 画像: viz パスに `.png` を付与
- Embedding API: パラメータなしの素の viz URL

---

## 検証手順

各ホストで **A → C → B → D の順**に叩く。順序には理由がある。

1. **A** で既定 CSP が効いていることを確認する。ここを飛ばすと、「csp を無視するホスト」と「frameDomains を尊重するホスト」を取り違える
2. **C** で外部リソース取得の可否を確認する
3. **B** が本命の frame-src
4. **D** が最も複雑なケース

### 記録する4値

各プローブについて以下を記録する。**4列すべてが埋まって初めて「対応している」と言える。**

1. `frameDomains 承認` — `hostCapabilities.sandbox.csp.frameDomains` に載ったか
2. `iframe 読込` — onload 発火 / CSP 違反なし
3. `viz 描画` — 目視で中身が見えるか
4. `操作可能` — ツールチップ・クリック・フィルタが効くか

1〜2 は診断パネルが自動で埋める。3〜4 は人間が目視で埋める。

### 調査対象ホスト（優先順）

1. Claude Desktop / claude.ai — stdio と HTTP の両方で。同じホストでもトランスポートで結果が変わりうるので必ず両方記録する
2. MCPJam Inspector — MCP Apps 対応クライアントのプロトタイプ実装があるので、リファレンス的な基準値として最初に使うとよい
3. ChatGPT / Apps SDK
4. VS Code
5. Goose、Postman

---

## View の中身

View の上半分が診断パネル、下半分が埋め込み領域。**ホストごとにスクリーンショットを1枚撮れば比較表が埋まる**状態にしてある。

パネルが表示するもの:

- **A. ホスト情報** — `ui/initialize` レスポンスの `hostInfo` / `protocolVersion` / `hostContext`
- **B. CSP 承認結果** — 宣言した csp と承認された csp、およびその差分。`frameDomains` を宣言したのに承認されなければ「ホストが frame-src を拒否」と赤字で断定する
- **C. sandbox 実測** — `window.origin`、`document.domain`、localStorage / sessionStorage / cookie の読み書き、`crossOriginIsolated`、UA。`window.origin` が `"null"` なら opaque origin と断定表示する
- **D. 埋め込み結果** — onload / onerror の発火、5秒タイムアウト判定、`tool-input` の受信有無、目視チェックリスト
- **E. CSP 違反ログ** — `securitypolicyviolation` イベントの全件

設計上の約束事:

- 診断パネルは **Tableau の読み込み成否に関わらず必ず描画される**。iframe 生成は try で囲み、失敗しても panel は残る
- `ui/initialize` が3秒以内に応答しなければ「MCP Apps 非対応の可能性」と表示して、それでもパネルを描画する
- 値が取れない項目は `—` ではなく `取得不可 (理由)` と出す。すべての try/catch は例外メッセージをパネルに表示する（ホストによっては devtools が開けない）
- ダークモード対策としてルート要素に明示的な背景色・文字色を置き、`hostContext.styles.variables` は使わない
- View 側は SDK を使わず、素の `postMessage` + JSON-RPC で書いてある。View 側 SDK の挙動を変数から外すため

---

## 設計判断の理由

**capability 非対応でも UI 付きツールを登録する。** 通常は `getUiCapability()` で `text/html;profile=mcp-app` の非対応を検出したら text-only 版に落とすのが推奨。だがこのサーバーは「非対応を検出すること」自体が目的なので、あえて登録して挙動を見る。クライアントが何を advertise したかは stderr にログする。

**ツールの `content` には必ずテキスト版の診断結果を入れる。** UI 非対応ホストでの graceful degradation の確認を兼ねる。本文だけが出てパネルが出なければ、そのホストは UI リソースを描画していない。

**deprecated な `_meta["ui/resourceUri"]` が出力に含まれる。** これは `registerAppTool()` が後方互換のために自動付与するもので、こちらのコードは `_meta.ui.resourceUri` しか書いていない。

**ext-apps の型を一部ローカル定義している。** 公開されている型エントリが `./types` を拡張子なしで re-export しているため、`moduleResolution: NodeNext` では解決できない。型2つのために解決モードを緩めるより、`ProbeCsp` と `UI_PROTOCOL_VERSION` をローカルに置くほうが影響が小さい。

---

## 既知の観測結果（ホスト実測の前に）

ローカルの偽ホスト（`sandbox="allow-scripts"` の iframe に View を入れただけ）で確認した挙動:

- `window.origin` は `"null"`（opaque origin）になる
- その状態で Tableau の viz を iframe 埋め込みすると、VizQL の `startSession` fetch が CORS で失敗し、**白画面になる**

つまり軸2は机上の懸念ではなく再現する。ホストが `frameDomains` を承認しても、`allow-same-origin` を付けていなければ viz は動かない。

---

## デプロイ（任意）

HTTP トランスポートは Docker イメージ1つで動くので、Fly.io などにそのまま載せられる。`Dockerfile` と `fly.toml` を同梱してある。

```bash
fly launch --no-deploy
fly deploy
```

**Fly.io は必須ではない。** stdio で使うなら不要だし、HTTP もローカルで完結する。Web ホストからの接続を試すときに公開エンドポイントが要るという、それだけの理由で置いてある。

---

## 成果物

- `results/TEMPLATE.md` — ホスト1つあたり1ファイルの記録雛形
- `results/README.md` — 全ホストの結果を1枚に集約するサマリ表（手動更新）

記録するときの注意: **社内 viz の URL やワークブック名をそのまま書かない。** 既定の viz は Tableau 公式のサンプルなので、そのまま書いてよい。

---

## 参照

- SEP-1865 仕様本文: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx
- SEP-1865 サマリ: https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- ext-apps リポジトリ: https://github.com/modelcontextprotocol/ext-apps
- Tableau Public の iframe 埋め込み: https://kb.tableau.com/articles/howto/embedding-tableau-public-views-in-iframes
- Tableau 埋め込みパラメータ一覧: https://help.tableau.com/current/pro/desktop/en-us/embed_list.htm
- Tableau Embedding API v3 設定: https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_configure.html

## ライセンス

MIT
