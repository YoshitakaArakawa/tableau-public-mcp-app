/**
 * Subset of `McpUiResourceCsp` we actually declare.
 *
 * Declared locally on purpose: the published `@modelcontextprotocol/ext-apps`
 * type entry re-exports `./types` without a file extension, so `moduleResolution:
 * NodeNext` cannot see those members. Keeping a local shape avoids loosening the
 * whole project's resolution mode for two type imports.
 */
export interface ProbeCsp {
  frameDomains?: string[];
  resourceDomains?: string[];
  connectDomains?: string[];
  baseUriDomains?: string[];
}

/**
 * MCP Apps protocol version the view announces in `ui/initialize`.
 * Mirrors `LATEST_PROTOCOL_VERSION` in @modelcontextprotocol/ext-apps (1.7.5).
 */
export const UI_PROTOCOL_VERSION = "2026-01-26";

/** Only this origin is accepted. Any other host would contradict the declared CSP. */
export const ALLOWED_ORIGIN = "https://public.tableau.com";

/** Fallback viz used when the caller does not pass `vizUrl`. */
export const DEFAULT_VIZ_URL = `${ALLOWED_ORIGIN}/views/DeveloperSuperstore/Overview`;

export const EMBED_API_SCRIPT_URL = `${ALLOWED_ORIGIN}/javascripts/api/tableau.embedding.3.latest.min.js`;

export type ProbeId = "A" | "B" | "C" | "D";

export type EmbedMode = "iframe" | "image" | "embedapi";

export interface ProbeDef {
  id: ProbeId;
  toolName: string;
  resourceUri: string;
  resourceName: string;
  title: string;
  /** `undefined` means "declare no csp at all" — that is the point of probe A. */
  csp?: ProbeCsp;
  embedMode: EmbedMode;
  expectation: string;
  /** What a result of this probe tells us. Shown in the view and in the text content. */
  question: string;
}

export const PROBES: ProbeDef[] = [
  {
    id: "A",
    toolName: "show_probe_a",
    resourceUri: "ui://tp/baseline",
    resourceName: "Probe A — baseline (no csp declared)",
    title: "A: csp 宣言なし",
    csp: undefined,
    embedMode: "iframe",
    expectation:
      "失敗するはず。ホスト既定 CSP は frame-src を含まないため、入れ子 iframe はブロックされる。",
    question:
      "既定 CSP が効いているか。ここが成功したら、そのホストは csp 宣言を無視して緩い CSP を当てている。",
  },
  {
    id: "B",
    toolName: "show_probe_b",
    resourceUri: "ui://tp/iframe",
    resourceName: "Probe B — frameDomains declared",
    title: "B: frameDomains 宣言あり",
    csp: { frameDomains: [ALLOWED_ORIGIN] },
    embedMode: "iframe",
    expectation: "未知。ホストが frame-src を開けるかどうかが分かれ目。",
    question: "本命。frameDomains が承認され、実際に frame-src が開くか。",
  },
  {
    id: "C",
    toolName: "show_probe_c",
    resourceUri: "ui://tp/image",
    resourceName: "Probe C — resourceDomains declared (static image)",
    title: "C: resourceDomains 宣言あり（静的画像）",
    csp: { resourceDomains: [ALLOWED_ORIGIN] },
    embedMode: "image",
    expectation: "未知。iframe より通りやすいはず。",
    question:
      "逃げ道の確認。B が全滅するホストでも C が通るなら、静止画という実用上の代替がある。",
  },
  {
    id: "D",
    toolName: "show_probe_d",
    resourceUri: "ui://tp/embedapi",
    resourceName: "Probe D — resourceDomains + frameDomains (Embedding API v3)",
    title: "D: resourceDomains + frameDomains（Embedding API v3）",
    csp: { resourceDomains: [ALLOWED_ORIGIN], frameDomains: [ALLOWED_ORIGIN] },
    embedMode: "embedapi",
    expectation: "未知。最も複雑。外部 script の読込と、その script が生成する iframe の両方が要る。",
    question:
      "外部 script 読込 + script が動的生成する iframe という二段構えが通るか。B と C が両方通って初めて成立しうる。",
  },
];

export function getProbe(id: ProbeId): ProbeDef {
  const probe = PROBES.find((p) => p.id === id);
  if (!probe) throw new Error(`unknown probe: ${id}`);
  return probe;
}

export function getProbeByResourceUri(uri: string): ProbeDef {
  const probe = PROBES.find((p) => p.resourceUri === uri);
  if (!probe) throw new Error(`unknown resource uri: ${uri}`);
  return probe;
}

/** iframe embedding needs both `:embed=true` and `:showVizHome=no`. */
export function toIframeUrl(vizUrl: string): string {
  return `${vizUrl}?:embed=true&:showVizHome=no`;
}

/** Tableau Public serves a static PNG snapshot at `<viz path>.png`. */
export function toImageUrl(vizUrl: string): string {
  return `${vizUrl}.png?:showVizHome=no`;
}

/** `<tableau-viz src>` takes the bare viz URL; the API adds its own parameters. */
export function toEmbedApiUrl(vizUrl: string): string {
  return vizUrl;
}

export function embedUrlFor(mode: EmbedMode, vizUrl: string): string {
  switch (mode) {
    case "iframe":
      return toIframeUrl(vizUrl);
    case "image":
      return toImageUrl(vizUrl);
    case "embedapi":
      return toEmbedApiUrl(vizUrl);
  }
}
