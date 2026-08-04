# プロトコル準拠状況

このサーバーが実装している MCP のリビジョンと、次の改訂で何が変わるかの記録です。20260804 時点。

結論を先に書きます。**このサーバーは `2025-11-25` 世代の仕様に乗っています。** 最新の `2026-07-28` には準拠していません。SDK が追随していないためで、意図的な選択です。

---

## 現在の準拠先

| 項目 | 値 |
|---|---|
| 導入 SDK | `@modelcontextprotocol/sdk` 1.30.0 |
| SDK の `LATEST_PROTOCOL_VERSION` | `2025-11-25` |
| npm の `dist-tags` | `latest: 1.30.0` のみ |

公式ブログは Tier 1 SDK が `2026-07-28` に即日対応したとしていますが、TypeScript SDK の npm 公開版は `2025-11-25` 止まりです。この差異の理由は未確認です。

---

## なぜ stateless を先に入れたか

`2026-07-28` の主眼は **MCP の stateless 化**です。プロトコルレベルのセッションと `Mcp-Session-Id` ヘッダーが削除され、`initialize` / `notifications/initialized` のハンドシェイクも廃止されます。狙いは「普通のラウンドロビン LB の背後で、どのインスタンスがどのリクエストを受けてもよい」状態です。

このサーバーは、`2025-11-25` の枠内で先に stateless 化しました。SDK の `sessionIdGenerator: undefined`（stateless モード）を使い、リクエストごとにサーバーとトランスポートを生成して捨てます。

前提として、このサーバーはサーバー→クライアントの通信を一切持ちません。capabilities は `tools` と `resources` だけで、sampling・elicitation・logging・通知のいずれも使いません。viz 状態スナップショットの push はブラウザ内（ウィジェット→ホスト）で完結しており、MCP のトランスポートを通らないためです。

先に入れておくと、SDK 対応後に残るのが**追加作業だけ**になります。セッション管理の解体という削除作業を後回しにせずに済みます。

### GET を 405 で塞いでいる理由

SDK の stateless モードには落とし穴があります。`validateSession` は `sessionIdGenerator === undefined` のとき検証せずに通すため、GET リクエストがそのまま SSE ストリームを開いてしまいます。リクエストごとにトランスポートを捨てる設計では、誰も書き込まず閉じもしない孤児ストリームが残ります。

そのため Express 層で GET と DELETE を 405 にしています。`2025-11-25` の Streamable HTTP 仕様は、SSE を提供しないサーバーが GET に 405 を返すことを明示的に許容しています。

実測では ChatGPT・MCPJam のいずれも、GET が 405 でも接続を継続しました。

---

## `2026-07-28` への移行で必要になること

セッション削除以外に、SDK 対応後も手当てが要る変更です。

- `server/discover` の実装が **MUST**（対応プロトコルバージョン・capabilities・identity の広告）
- HTTP GET エンドポイントの廃止と `subscriptions/listen` への置き換え
- 全 result への `resultType` フィールド必須化（`"complete"` / `"input_required"`）
- `tools/list` 等の結果への `ttlMs` / `cacheScope` 必須化
- Streamable HTTP POST への `Mcp-Method` / `Mcp-Name` ヘッダー必須化
- サーバー起点リクエスト（sampling・elicitation・roots）の Multi Round-Trip Requests への置き換え

いずれも SDK 側の対応が前提で、手書きで追随する範囲ではありません。

MCP Apps (SEP-1865) が新設の extensions フレームワークの下でどう位置づけられるかは**未確認**です。`@modelcontextprotocol/ext-apps` も 1.7.5 から動いていません。

---

## クライアント側の状況

MCPJam Inspector は接続時にまず `server/discover` をプローブし、応答が無いと旧手順にフォールバックしました（20260804 実測）。クライアント側はすでに新仕様に踏み出しています。

---

## 出典

- [Key Changes — MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [The 2026-07-28 Specification | MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
