const cheerio = require("cheerio");
const { httpsUrl } = require("./core.cjs");
function plain(value) {
  return cheerio
    .load(String(value || ""), {}, false)
    .text()
    .replace(/\s+/g, " ")
    .trim();
}
function postURL(value) {
  const u = new URL(String(value));
  if (u.protocol === "http:" && u.hostname.endsWith(".blogspot.com"))
    u.protocol = "https:";
  return httpsUrl(u.href).href;
}
function taxonomy(input, site, catalog, identity) {
  const ids = (value) => {
    if (!Array.isArray(value) || value.length > 30)
      throw Error("분류는 최대 30개 선택하세요.");
    const parsed = value.map(Number);
    if (parsed.some((v) => !Number.isInteger(v) || v <= 0))
      throw Error("분류 ID가 올바르지 않습니다.");
    return [...new Set(parsed)];
  };
  const categoryIds = ids(input.categoryIds || []),
    tagIds = ids(input.tagIds || []);
  if (site?.type === "wordpress") {
    if ((categoryIds.length || tagIds.length) && catalog?.siteKey !== identity)
      throw Error("사이트 분류를 먼저 불러오세요.");
    if (
      categoryIds.some(
        (id) => !catalog?.categories?.some((c) => c.id === id),
      ) ||
      tagIds.some((id) => !catalog?.tags?.some((c) => c.id === id))
    )
      throw Error(
        "선택한 카테고리·태그가 최신 목록에 없습니다. 다시 불러오세요.",
      );
    return { categoryIds, tagIds, labels: [] };
  }
  const labels = [
    ...new Set(
      (Array.isArray(input.labels) ? input.labels : [])
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  ];
  if (labels.length > 20 || labels.some((v) => v.length > 100))
    throw Error("Blogger 라벨은 100자 이하로 최대 20개 입력하세요.");
  return {
    categoryIds: [],
    tagIds: [],
    labels: site?.type === "blogger" ? labels : [],
  };
}
function titleKey(text) {
  return plain(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
const stop = new Set([
  "ai",
  "도구",
  "사용법",
  "활용",
  "가이드",
  "추천",
  "비교",
  "정리",
  "방법",
  "소개",
  "대한",
  "위한",
  "있는",
]);
function terms(text) {
  const result = new Set();
  for (const word of plain(text)
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || []) {
    if (stop.has(word)) continue;
    result.add(word);
    if (/[가-힣]/.test(word) && word.length >= 3)
      for (let i = 0; i < word.length - 1; i++)
        result.add(word.slice(i, i + 2));
  }
  return result;
}
function similarity(a, b) {
  const x = terms(a),
    y = terms(b);
  if (!x.size || !y.size) return 0;
  return [...x].filter((v) => y.has(v)).length / Math.sqrt(x.size * y.size);
}
function links(d, posts) {
  return posts
    .filter((p) => p.siteId === d.siteId && p.url && p.url !== d.publishedUrl)
    .map((p) => ({
      ...p,
      score:
        similarity((d.topic || "") + " " + (d.title || ""), p.title) +
        (p.categoryIds?.some((id) => d.categoryIds?.includes(id)) ? 0.12 : 0),
    }))
    .filter((p) => p.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
function duplicates(topic, siteId, posts, drafts, exclude) {
  const key = titleKey(topic);
  if (!key) return [];
  const unique = new Map();
  for (const p of [...posts, ...drafts.filter((d) => d.id !== exclude)]) {
    if (p.siteId !== siteId) continue;
    const title = p.title || p.topic;
    if (titleKey(title) !== key && similarity(topic, title) < 0.72) continue;
    const id = p.url || p.publishedUrl || p.id;
    if (!unique.has(id))
      unique.set(id, {
        id: p.id,
        title,
        url: p.url || p.publishedUrl || "",
        exact: titleKey(title) === key,
      });
  }
  return [...unique.values()].slice(0, 5);
}
async function syncTaxonomy(site, request, headers, identity, posts) {
  const categories = [],
    tags = [];
  let truncated = false;
  if (site.type === "wordpress") {
    for (const [name, list] of [
      ["categories", categories],
      ["tags", tags],
    ])
      for (let page = 1; page <= 5; page++) {
        const response = await request(
          httpsUrl(site.url).href.replace(/\/$/, "") +
            `/wp-json/wp/v2/${name}?per_page=100&page=${page}&_fields=id,name`,
          { headers },
          true,
        );
        const values = response.data;
        if (!Array.isArray(values))
          throw Error("WordPress 분류 응답이 올바르지 않습니다.");
        list.push(
          ...values
            .filter((v) => Number.isInteger(v.id))
            .map((v) => ({ id: v.id, name: plain(v.name) })),
        );
        const total = Number(response.totalPages);
        if (
          values.length < 100 ||
          (Number.isFinite(total) && total > 0 && page >= total)
        )
          break;
        if (page === 5) truncated = true;
      }
  }
  return {
    siteKey: identity,
    categories,
    tags,
    labels: [
      ...new Set(
        posts
          .filter((p) => p.siteId === site.id)
          .flatMap((p) => p.labels || []),
      ),
    ].sort(),
    taxonomyAt: new Date().toISOString(),
    taxonomyTruncated: truncated,
  };
}
async function postsPage(
  site,
  catalog,
  request,
  headers,
  identity,
  reset = false,
) {
  const current = catalog?.siteKey === identity && !reset ? catalog : {};
  let url;
  if (site.type === "wordpress") {
    const page = current.nextPage || 1;
    url =
      httpsUrl(site.url).href.replace(/\/$/, "") +
      `/wp-json/wp/v2/posts?status=publish&per_page=100&page=${page}&orderby=id&order=desc&_fields=id,title,link,date_gmt,modified_gmt,categories,tags,excerpt`;
  } else {
    const u = new URL(
      `https://www.googleapis.com/blogger/v3/blogs/${site.blogId}/posts`,
    );
    u.search = new URLSearchParams({
      status: "LIVE",
      view: "ADMIN",
      fetchBodies: "false",
      fetchImages: "false",
      maxResults: "100",
      ...(current.nextPageToken ? { pageToken: current.nextPageToken } : {}),
    }).toString();
    url = u.href;
  }
  const response = await request(url, { headers }, true);
  const data = response.data;
  const items = site.type === "wordpress" ? data : data?.items || [];
  if (!Array.isArray(items))
    throw Error("기존 글 목록 응답이 올바르지 않습니다.");
  const posts = [],
    skipped = [];
  for (const p of items) {
    try {
      if (!p.id) throw Error();
      posts.push({
        id: site.id + ":" + p.id,
        remoteId: String(p.id),
        siteId: site.id,
        siteKey: identity,
        title: plain(site.type === "wordpress" ? p.title?.rendered : p.title),
        url: postURL(site.type === "wordpress" ? p.link : p.url),
        publishedAt:
          site.type === "wordpress"
            ? p.date_gmt
              ? p.date_gmt + "Z"
              : ""
            : p.published || "",
        updatedAt:
          site.type === "wordpress"
            ? p.modified_gmt
              ? p.modified_gmt + "Z"
              : ""
            : p.updated || "",
        categoryIds: site.type === "wordpress" ? p.categories || [] : [],
        tagIds: site.type === "wordpress" ? p.tags || [] : [],
        labels: site.type === "blogger" ? p.labels || [] : [],
        excerpt: plain(p.excerpt?.rendered || "").slice(0, 1000),
        importedAt: new Date().toISOString(),
      });
    } catch {
      skipped.push(String(p.id || "unknown"));
    }
  }
  const page = current.nextPage || 1;
  const total = Number(response.totalPages);
  const complete =
    site.type === "wordpress"
      ? Number.isFinite(total) && total > 0
        ? page >= total
        : items.length < 100
      : !data?.nextPageToken;
  return {
    posts,
    skipped,
    cursor: {
      siteKey: identity,
      nextPage: page + 1,
      nextPageToken: data?.nextPageToken || "",
      postsComplete: complete,
      postsAt: new Date().toISOString(),
    },
  };
}
module.exports = {
  plain,
  postURL,
  taxonomy,
  titleKey,
  similarity,
  links,
  duplicates,
  syncTaxonomy,
  postsPage,
};
