const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isPublicAddress,
  sourceURL,
  extractPage,
  createCollector,
} = require("../electron/sources.cjs");
const page =
  "<html><title>공식 안내</title><body><nav>삭제할 메뉴</nav><main><h1>가격과 기능</h1><p>" +
  "실제로 확인할 수 있는 본문 문장입니다. ".repeat(12) +
  "</p><script>doNotRun()</script></main></body></html>";
test("URL 수집은 내부·자격증명·비HTTPS 주소 차단", () => {
  for (const url of [
    "http://example.com",
    "https://localhost/x",
    "https://a.local/x",
    "https://user:pass@example.com",
    "https://example.com:8443",
  ])
    assert.throws(() => sourceURL(url));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("93.184.216.34"), true);
});
test("본문 추출은 스크립트·메뉴 제거, 출처·해시·절단 표시 보관", () => {
  const value = extractPage(page, "https://example.com");
  assert.equal(value.title, "공식 안내");
  assert.ok(value.text.includes("가격과 기능"));
  assert.ok(!value.text.includes("doNotRun"));
  assert.ok(!value.text.includes("삭제할 메뉴"));
  assert.equal(value.contentHash.length, 64);
  assert.ok(value.fetchedAt);
  assert.throws(
    () => extractPage("<p>짧음</p>", "https://example.com"),
    /부족/,
  );
  assert.equal(
    extractPage("긴 내용 ".repeat(8000), "https://example.com", "text/plain")
      .truncated,
    true,
  );
});
test("DNS 결과를 고정하고 모든 리다이렉트를 재검사", async () => {
  const calls = [];
  const collect = createCollector({
    lookup: async (host) => [
      {
        address:
          host === "internal.example.com" ? "127.0.0.1" : "93.184.216.34",
        family: 4,
      },
    ],
    transport: async (url, ip) => {
      calls.push({ url: url.href, ip });
      return { redirect: "https://internal.example.com/private" };
    },
  });
  await assert.rejects(() => collect("https://example.com"), /공개 인터넷/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ip.address, "93.184.216.34");
});
test("DNS 혼합 사설 주소 거부, 정상 페이지 수집 성공", async () => {
  const blocked = createCollector({
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    transport: () => {
      throw Error("must not request");
    },
  });
  await assert.rejects(() => blocked("https://example.com"), /공개 인터넷/);
  const ok = createCollector({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async () => ({ raw: page, mime: "text/html" }),
  });
  assert.equal((await ok("https://example.com")).title, "공식 안내");
});
