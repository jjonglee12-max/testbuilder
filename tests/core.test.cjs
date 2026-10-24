const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  html,
  fingerprint,
  issues,
  assertApproved,
  httpsUrl,
} = require("../electron/core.cjs");
const site = {
  id: "s",
  type: "wordpress",
  url: "https://example.com",
  username: "editor",
};
const draft = () => ({
  title: "AI 도구 가이드",
  body: "확인한 내용입니다.",
  siteId: "s",
  status: "approved",
});
test("승인 없는 원고 발행 차단", () =>
  assert.throws(() => assertApproved(draft(), site), /승인/));
test("승인한 정확한 원고만 통과, 본문·제목·사이트 변경 차단", () => {
  const d = draft();
  d.approval = { hash: fingerprint(d, site) };
  assert.doesNotThrow(() => assertApproved(d, site));
  for (const v of [
    { ...d, body: "변경" },
    { ...d, title: "수정" },
    { ...d, siteId: "other" },
  ])
    assert.throws(() => assertApproved(v, site), /승인/);
  assert.throws(
    () => assertApproved(d, { ...site, url: "https://other.com" }),
    /승인/,
  );
});
test("발행 완료·진행 중·불확실 원고 재발행 차단", () => {
  for (const status of ["published", "publishing", "uncertain"]) {
    const d = { ...draft(), status };
    d.approval = { hash: fingerprint(d, site) };
    assert.throws(() => assertApproved(d, site), /결과 확인/);
  }
});
test("미확인 내용·빈 제목·빈 사이트 차단", () => {
  assert.ok(issues({ ...draft(), body: "가격 확인 필요" }).length);
  assert.ok(issues({ ...draft(), title: "" }).length);
  assert.ok(issues({ ...draft(), siteId: "" }).length);
});
test("발행 HTML은 원고의 스크립트와 태그를 이스케이프", () => {
  const value = html("## 제목\n\n<script>alert(1)</script>\n두 번째 줄");
  assert.ok(value.includes("<h2>제목</h2>"));
  assert.ok(value.includes("&lt;script&gt;"));
  assert.ok(!value.includes("<script>"));
  assert.ok(value.includes("<br>"));
});
test("인증 전송은 HTTPS 및 인증정보 없는 URL만", () => {
  assert.throws(() => httpsUrl("http://example.com"));
  assert.throws(() => httpsUrl("https://user:pass@example.com"));
  assert.equal(httpsUrl("https://example.com").protocol, "https:");
});
