const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  publication,
  future,
  images,
  imageFormat,
  due,
} = require("../electron/delivery.cjs");
const { fingerprint, html } = require("../electron/core.cjs");
const { reviewHash } = require("../electron/editorial.cjs");
test("예약 날짜는 UTC로 정규화하고 과거·임박·잘못된 시간 차단", () => {
  assert.deepEqual(publication(), { mode: "now" });
  assert.equal(
    publication({ mode: "remote", at: "2027-01-01T10:00:00+09:00" }).at,
    "2027-01-01T01:00:00.000Z",
  );
  assert.throws(() => publication({ mode: "bad" }));
  assert.throws(() => publication({ mode: "local", at: "invalid" }));
  assert.throws(
    () =>
      future(
        { mode: "local", at: "2027-01-01T01:00:30Z" },
        Date.parse("2027-01-01T01:00:00Z"),
      ),
    /1분/,
  );
});
test("이미지 자산·대체 텍스트·대표 이미지 수·HTTPS 검증", () => {
  const input = { id: "i", assetId: "m", alt: "설명", featured: true };
  assert.equal(images([input], [{ id: "m" }])[0].featured, true);
  assert.throws(
    () => images([{ ...input, assetId: "unknown" }], [{ id: "m" }]),
    /찾을/,
  );
  assert.throws(() => images([{ ...input, alt: "" }], [{ id: "m" }]), /대체/);
  assert.throws(
    () => images([{ id: "i", url: "javascript:alert(1)", alt: "a" }]),
    /HTTPS/,
  );
  assert.throws(
    () => images([input, { ...input, id: "i2" }], [{ id: "m" }]),
    /하나/,
  );
  assert.throws(
    () => imageFormat(Buffer.from('<svg onload="alert(1)"></svg>')),
    /PNG/,
  );
});
test("승인에는 이미지와 예약 시각 포함, AI 검토는 예약 시각만 변경 시 재사용", () => {
  const d = {
      title: "제목",
      body: "본문",
      siteId: "s",
      images: [],
      publication: { mode: "remote", at: "2027-01-01T00:00:00Z" },
    },
    site = { id: "s", url: "https://example.com" };
  const next = {
    ...d,
    publication: { mode: "remote", at: "2027-01-02T00:00:00Z" },
  };
  assert.notEqual(fingerprint(d, site), fingerprint(next, site));
  assert.equal(reviewHash(d, site, []), reviewHash(next, site, []));
  assert.notEqual(
    reviewHash(d, site, []),
    reviewHash(
      {
        ...d,
        images: [
          { id: "i", url: "https://example.com/image.png", alt: "사진" },
        ],
      },
      site,
      [],
    ),
  );
});
test("발행 HTML은 이미지·캡션을 이스케이프하고 HTTPS 링크만 활성화", () => {
  const value = html(
    "자료 https://example.com/docs\n\n<script>bad()</script>",
    [
      {
        url: "https://example.com/image.png",
        alt: '" onerror="x',
        caption: "<script>x</script>",
        position: "top",
      },
    ],
  );
  assert.ok(value.startsWith("<figure>"));
  assert.ok(value.includes('alt="&quot; onerror=&quot;x"'));
  assert.ok(value.includes("&lt;script&gt;"));
  assert.ok(value.includes('<a href="https://example.com/docs"'));
  assert.ok(!value.includes("<script>"));
  assert.throws(() => html("text", [{ url: "javascript:alert(1)", alt: "x" }]));
});
test("로컬 예약만 만료 검사, 5분 넘긴 예약은 보류 대상으로 분리", () => {
  const now = Date.parse("2027-01-01T01:00:00Z");
  assert.deepEqual(
    due(
      [
        {
          id: "a",
          status: "queued",
          publication: { at: "2027-01-01T00:59:00Z" },
        },
        {
          id: "b",
          status: "queued",
          publication: { at: "2027-01-01T00:54:00Z" },
        },
        {
          id: "c",
          status: "remote_scheduled",
          publication: { at: "2027-01-01T00:59:00Z" },
        },
      ],
      now,
    ),
    [
      { id: "a", missed: false },
      { id: "b", missed: true },
    ],
  );
});

test("공식 출처 Markdown 링크와 문장 부호를 안전하게 처리, 대표 전용 이미지는 본문 제외", () => {
  const value = html(
    "[공식 문서](https://example.com/docs) 그리고 https://example.com/info.",
  );
  assert.ok(value.includes(">공식 문서</a>"));
  assert.ok(value.includes('href="https://example.com/info"'));
  assert.ok(
    !html("본문", [
      {
        url: "https://example.com/a.png",
        alt: "대표",
        position: "featured_only",
      },
    ]).includes("<img"),
  );
  assert.throws(
    () => publication({ mode: "remote", at: "2027-01-01T10:00" }),
    /시간대/,
  );
});
