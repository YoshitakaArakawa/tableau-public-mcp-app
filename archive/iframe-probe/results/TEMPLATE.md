# <ホスト名> / <トランスポート>

ホスト1つ・トランスポート1つにつき1ファイル。ファイル名は `claude-desktop-stdio.md` のように付ける。

同じホストでも stdio と HTTP で結果が変わりうる。**必ず別ファイルに分ける。**

## 環境

| 項目 | 値 |
|---|---|
| ホスト名 / バージョン | |
| トランスポート | stdio / http |
| OS | |
| 検証日 (YYYYMMDD) | |
| サーバー版数 | |
| `hostInfo.name` / `version`（パネル A より） | |
| `protocolVersion` | |
| クライアントの ui capability（サーバー stderr ログ） | |

## 結果

各セルは `yes` / `no` / `観測不可` のいずれか。推測で `no` と書かない。観測できなかったものは `観測不可` と書く。

| プローブ | frameDomains 承認 | iframe 読込 | viz 描画 | 操作可能 |
|---|---|---|---|---|
| A（csp なし） | | | | |
| C（resourceDomains） | | | | |
| B（frameDomains） | | | | |
| D（両方 / Embedding API） | | | | |

叩く順序は A → C → B → D。表の行順もそれに合わせてある。

## sandbox 実測（パネル C）

| 項目 | 値 |
|---|---|
| `window.origin` | |
| `document.domain` | |
| localStorage | |
| sessionStorage | |
| document.cookie | |
| `crossOriginIsolated` | |

`window.origin` が `"null"` なら、frame-src が開いていても外部 viz は動かない。その場合は「B が読込 yes / 描画 no」になるはずで、そこが軸1と軸2を切り分ける地点。

## CSP 違反ログ（パネル E）

```
（パネル E の内容を貼る。0件なら「違反なし」と書く）
```

## visibility の挙動

| 項目 | 結果 |
|---|---|
| `probe_app_only` がモデルの tools/list に見えたか | |

見えていたら、そのホストは `_meta.ui.visibility` に未対応（仕様の MUST 違反）。

## スクリーンショット

<!-- 診断パネル全体のスクショを貼る。プローブごとに1枚。 -->

- A:
- C:
- B:
- D:

## 自由記述

<!-- 仕様の MUST に反する挙動を見つけたら、ここに明記する。それ自体が成果。 -->
<!-- 社内 viz の URL・ワークブック名・サイト名は書かない。書くならダミー化する。 -->
