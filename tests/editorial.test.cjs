const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  profile,
  reviewHash,
  parseReview,
  checkReview,
} = require("../electron/editorial.cjs");
const site = {
  id: "s",
  type: "wordpress",
  url: "https://example.com",
  profile: { audience: "초보자" },
};
const refs = [
  {
    id: "r",
    contentHash: "hash",
    url: "https://example.com/docs",
    text: "근거",
  },
];
const draft = {
  title: "AI",
  body: "내용",
  siteId: "s",
  sourceIds: ["r"],
  sources: "메모",
  generation: { model: "x" },
};
test("사이트별 기준 기본값과 독자 설정 유지", () => {
  assert.equal(profile(site.profile).audience, "초보자");
  assert.ok(profile().tone);
});
test("검토는 원고·자료·편집 기준 변경 시 무효, AI 초안 무검토 승인 차단", () => {
  assert.throws(() => checkReview(draft, site, refs), /별도 AI 검토/);
  const d = {
    ...draft,
    review: { hash: reviewHash(draft, site, refs), verdict: "ready_for_human" },
  };
  assert.doesNotThrow(() => checkReview(d, site, refs));
  for (const changed of [
    { ...d, body: "수정" },
    { ...d, sources: "메모 변경" },
    { ...d, sourceIds: [] },
  ])
    assert.throws(() => checkReview(changed, site, refs), /변경/);
  assert.throws(
    () => checkReview(d, { ...site, profile: { audience: "전문가" } }, refs),
    /변경/,
  );
  assert.throws(
    () => checkReview(d, site, [{ ...refs[0], contentHash: "new" }]),
    /변경/,
  );
  assert.throws(
    () =>
      checkReview(
        { ...d, review: { ...d.review, verdict: "needs_changes" } },
        site,
        refs,
      ),
    /수정 필요/,
  );
});
test("AI 판정에 상관없이 차단 지적·불일치 사실은 수정 필요", () => {
  const r = parseReview(
    {
      verdict: "ready_for_human",
      summary: "검토",
      findings: [{ severity: "blocker", message: "허구 경험" }],
      claims: [],
    },
    [],
  );
  assert.equal(r.verdict, "needs_changes");
  const c = parseReview(
    {
      verdict: "ready_for_human",
      summary: "검토",
      findings: [],
      claims: [{ claim: "비교", status: "unsupported" }],
    },
    [],
  );
  assert.equal(c.verdict, "needs_changes");
});
test("가짜 출처 ID로 검증 완료 표시 불가, 형식 오류 거부", () => {
  const r = parseReview(
    {
      verdict: "ready_for_human",
      summary: "검토",
      findings: [],
      claims: [{ claim: "가격", status: "supported", sourceIds: ["invented"] }],
    },
    ["real"],
  );
  assert.equal(r.claims[0].status, "uncertain");
  assert.deepEqual(r.claims[0].sourceIds, []);
  assert.throws(() => parseReview({ verdict: "PASS" }, []), /형식/);
});
