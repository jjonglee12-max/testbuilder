const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../electron/catalog.cjs");
const { fingerprint } = require("../electron/core.cjs");
const { reviewHash } = require("../electron/editorial.cjs");
test("실제 분류 ID 검증·Blogger 라벨 정규화와 한도", () => {
  const site = { type: "wordpress" },
    catalog = { siteKey: "key", categories: [{ id: 3 }], tags: [{ id: 9 }] };
  assert.deepEqual(
    C.taxonomy({ categoryIds: ["3", 3], tagIds: [9] }, site, catalog, "key"),
    { categoryIds: [3], tagIds: [9], labels: [] },
  );
  assert.throws(
    () => C.taxonomy({ categoryIds: [7] }, site, catalog, "key"),
    /최신/,
  );
  assert.throws(
    () => C.taxonomy({ categoryIds: ["bad"] }, site, catalog, "key"),
    /ID/,
  );
  assert.throws(
    () => C.taxonomy({ categoryIds: [3] }, site, catalog, "changed"),
    /먼저/,
  );
  assert.deepEqual(
    C.taxonomy({ labels: [" AI ", "AI", "문서"] }, { type: "blogger" }).labels,
    ["AI", "문서"],
  );
});
test("카테고리·라벨 변경은 사람 재승인 대상, 내용 검토는 재사용 가능", () => {
  const site = { id: "s" },
    d = { title: "글", body: "본문", siteId: "s" };
  const next = { ...d, categoryIds: [3], labels: ["AI"] };
  assert.notEqual(fingerprint(d, site), fingerprint(next, site));
  assert.equal(reviewHash(d, site, []), reviewHash(next, site, []));
});
test("같은 사이트 실제 링크만 추천, 동일 발행 글 중복 경고 제거", () => {
  const posts = [
    {
      id: "p",
      siteId: "s",
      title: "회의록 정리 기준",
      url: "https://example.com/p",
    },
    {
      id: "other",
      siteId: "other",
      title: "회의록 정리 기준",
      url: "https://other.com/p",
    },
  ];
  assert.equal(
    C.links({ siteId: "s", topic: "회의록 정리" }, posts)[0].id,
    "p",
  );
  assert.equal(
    C.duplicates("회의록 정리 기준", "s", posts, [
      {
        id: "local",
        siteId: "s",
        title: "회의록 정리 기준",
        publishedUrl: "https://example.com/p",
      },
    ]).length,
    1,
  );
  assert.equal(
    C.postURL("http://example.blogspot.com/2026/a.html"),
    "https://example.blogspot.com/2026/a.html",
  );
  assert.throws(() => C.postURL("javascript:alert(1)"));
});
test("WordPress 페이지 메타와 HTML 제목 처리, Blogger 다음 페이지 토큰 유지", async () => {
  const site = { id: "s", type: "wordpress", url: "https://example.com" };
  const result = await C.postsPage(
    site,
    {},
    async (url, options, meta) => {
      assert.ok(url.includes("status=publish"));
      assert.equal(meta, true);
      return {
        data: [
          {
            id: 1,
            title: { rendered: "AI &amp; &lt;도구&gt;" },
            link: "https://example.com/p",
            categories: [3],
            tags: [9],
          },
        ],
        totalPages: "2",
      };
    },
    {},
    "key",
    true,
  );
  assert.equal(result.posts[0].title, "AI & <도구>");
  assert.equal(result.cursor.nextPage, 2);
  assert.equal(result.cursor.postsComplete, false);
  const b = await C.postsPage(
    { id: "b", type: "blogger", blogId: "123" },
    { siteKey: "k", nextPageToken: "token" },
    async (url) => {
      assert.equal(new URL(url).searchParams.get("pageToken"), "token");
      return { data: { items: [], nextPageToken: "next" } };
    },
    {},
    "k",
  );
  assert.equal(b.cursor.nextPageToken, "next");
  assert.equal(b.cursor.postsComplete, false);
});

test("분류가 정확히 100개여도 전체 페이지 헤더를 사용해 불필요한 다음 페이지 요청 방지", async () => {
  const calls = [];
  const result = await C.syncTaxonomy(
    { id: "s", type: "wordpress", url: "https://example.com" },
    async (url, options, meta) => {
      calls.push(url);
      assert.equal(meta, true);
      return {
        data: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: "분류 " + i,
        })),
        totalPages: "1",
      };
    },
    {},
    "key",
    [],
  );
  assert.equal(calls.length, 2);
  assert.equal(result.categories.length, 100);
  assert.equal(result.taxonomyTruncated, false);
});
