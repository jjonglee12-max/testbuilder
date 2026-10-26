const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  installUpdates,
  validateHTML,
  safePreview,
} = require("../electron/updates.cjs");
const { fingerprint } = require("../electron/core.cjs");
function fixture(type = "blogger") {
  const s = { id: "s", type, url: "https://example.com", blogId: "12" };
  const state = {
    sites: [s],
    drafts: [],
    sources: [],
    posts: [],
    catalogs: {},
    ai: { endpoint: "https://api.example.com/v1", model: "test" },
  };
  const calls = [],
    handlers = {};
  let remote = {
      id: "44",
      status: "LIVE",
      title: "원문",
      content:
        '<!-- wp:paragraph --><p>기존 본문 <a href="https://example.com/a">링크</a></p><!-- /wp:paragraph -->',
      updated: "2026-10-01T00:00:00Z",
      published: "2025-01-01T00:00:00Z",
      url: "https://example.com/posts/44",
      labels: ["AI"],
    },
    failure = "",
    gate,
    alter = false;
  if (type === "wordpress")
    remote = {
      ...remote,
      status: "publish",
      title: { raw: "원문" },
      content: { raw: remote.content },
      modified_gmt: "2026-10-01T00:00:00",
      date_gmt: "2025-01-01T00:00:00",
      link: remote.url,
      categories: [],
      tags: [],
      featured_media: 9,
    };
  let saves = 0,
    backups = 0;
  const identity = () => type + ":site";
  const request = async (url, options = {}, meta) => {
    calls.push({ url, ...options });
    if (url.includes("chat/completions"))
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "수정 제목",
                body: "<p>검증된 수정안</p>",
                notes: "변경 내역",
              }),
            },
          },
        ],
      };
    if (url.includes("/categories") || url.includes("/tags"))
      return meta ? { data: [], totalPages: 1 } : [];
    if (options.method) {
      if (failure) throw Error(failure);
      const v = JSON.parse(options.body);
      remote = {
        ...remote,
        title: type === "wordpress" ? { raw: v.title } : v.title,
        content: type === "wordpress" ? { raw: v.content } : v.content,
        ...(type === "blogger" ? { labels: v.labels } : {}),
      };
      if (alter) remote.content = "<p>서버에서 다른 본문 반환</p>";
      return remote;
    }
    if (gate) await gate;
    return { data: structuredClone(remote), etag: '"v1"' };
  };
  installUpdates({
    ipcMain: { handle: (k, f) => (handlers[k] = f) },
    getState: () => state,
    persist() {},
    publicState: () => state,
    request,
    headers: () => ({ Authorization: "test" }),
    siteIdentity: identity,
    saveDraft: (v, ctx = {}) => {
      saves++;
      const old = state.drafts.find((d) => d.id === v.id),
        d = {
          ...v,
          id: old?.id || "d" + saves,
          format: old?.format || ctx.format,
          updateTarget: old?.updateTarget || ctx.updateTarget,
          status: "draft",
        };
      state.drafts = state.drafts.filter((v) => v.id !== d.id);
      state.drafts.push(d);
      return d;
    },
    assertDraftIdle() {},
    storage: {
      snapshot: async () => {
        backups++;
      },
      record() {},
    },
    aiHeaders: () => ({}),
  });
  return {
    state,
    calls,
    handlers,
    s,
    invoke: (k, v) => handlers[k](null, v),
    approve(d) {
      d.status = "approved";
      d.approval = { hash: fingerprint(d, s) };
    },
    get remote() {
      if (alter) remote.content = "<p>서버에서 다른 본문 반환</p>";
      return remote;
    },
    pauseReads() {
      let release;
      gate = new Promise((r) => (release = r));
      return release;
    },
    set alter(v) {
      alter = v;
    },
    set failure(v) {
      failure = v;
    },
    get backups() {
      return backups;
    },
  };
}
test("HTML 원문과 블록 주석은 그대로 보존하고 실행 가능한 HTML은 거부한다", () => {
  const body = "<!-- wp:paragraph --><p>원문</p><!-- /wp:paragraph -->";
  assert.equal(validateHTML(body), body);
  for (const h of [
    "<script>x</script>",
    '<img onerror="x()">',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://example.com"></iframe>',
  ])
    assert.throws(() => validateHTML(h));
  const preview = safePreview(
    '<script>alert(1)</script><img src="https://x.test/x"><a href="https://x.test">링크</a>',
  );
  assert.ok(!preview.includes("<script"));
  assert.ok(!preview.includes("https://x.test"));
  assert.ok(preview.includes("default-src 'none'"));
});
test("기존 글 불러오기는 원격 쓰기를 하지 않으며 원문을 보존한다", async () => {
  const f = fixture(),
    r = await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" }),
    d = f.state.drafts[0];
  assert.equal(d.body, f.remote.content);
  assert.equal(d.format, "html");
  assert.equal(d.updateTarget.remoteId, "44");
  assert.equal(d.publication.mode, "now");
  assert.equal(f.calls.filter((c) => c.method).length, 0);
  assert.equal(r.draftId, d.id);
});
test("별도 승인한 수정안은 같은 원격 ID에만 반영하고 발행일을 보내지 않는다", async () => {
  for (const type of ["blogger", "wordpress"]) {
    const f = fixture(type);
    await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" });
    const d = f.state.drafts[0];
    d.body = "<p>수정안</p>";
    f.approve(d);
    await f.invoke("applyPostUpdate", d.id);
    const writes = f.calls.filter((c) => c.method);
    assert.equal(writes.length, 1);
    assert.ok(writes[0].url.endsWith("/posts/44"));
    assert.equal(writes[0].method, type === "wordpress" ? "POST" : "PATCH");
    const body = JSON.parse(writes[0].body);
    for (const key of [
      "status",
      "date",
      "date_gmt",
      "published",
      "featured_media",
    ])
      assert.equal(body[key], undefined);
    assert.equal(writes[0].headers["If-Match"], '"v1"');
    assert.equal(d.status, "updated");
    assert.equal(f.backups, 1);
    await assert.rejects(f.invoke("applyPostUpdate", d.id), /발행되었거나/);
  }
});
test("원격본 변경 감지는 쓰기 전에 중단하고 기존 승인 제거", async () => {
  const f = fixture();
  await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" });
  const d = f.state.drafts[0];
  d.body = "<p>수정안</p>";
  f.approve(d);
  f.remote.content = "<p>다른 사람이 편집</p>";
  await assert.rejects(f.invoke("applyPostUpdate", d.id), /변경/);
  assert.equal(d.updateConflict, true);
  assert.equal(d.approval, undefined);
  assert.equal(f.calls.filter((c) => c.method).length, 0);
});
test("412 충돌과 통신 오류는 자동 재시도 없이 결과 조회로 전환한다", async () => {
  for (const failure of ["HTTP 412", "network disconnected"]) {
    const f = fixture();
    await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" });
    const d = f.state.drafts[0];
    d.body = "<p>수정안</p>";
    f.approve(d);
    f.failure = failure;
    await assert.rejects(f.invoke("applyPostUpdate", d.id));
    assert.equal(d.status, failure.includes("412") ? "conflict" : "uncertain");
    assert.equal(f.calls.filter((c) => c.method).length, 1);
    f.failure = "";
    await f.invoke("checkPostUpdate", d.id);
    assert.equal(d.status, "draft");
    assert.equal(d.updateConflict, undefined);
    assert.equal(f.calls.filter((c) => c.method).length, 1);
  }
});
test("AI 수정 제안은 로컬 원고만 변경하고 승인과 원격 쓰기를 수행하지 않는다", async () => {
  const f = fixture();
  await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" });
  await f.invoke("suggestPostUpdate", {
    id: f.state.drafts[0].id,
    instruction: "공식 설명에 맞춰 수정",
  });
  const d = f.state.drafts[0];
  assert.equal(d.body, "<p>검증된 수정안</p>");
  assert.equal(d.status, "draft");
  assert.ok(d.generation);
  assert.equal(
    f.calls.filter((c) => c.method && !c.url.includes("chat/completions"))
      .length,
    0,
  );
  await assert.rejects(f.invoke("applyPostUpdate", d.id), /다시 승인/);
});

test("반영 전 조회가 겹쳐도 원격 쓰기는 한 번만 수행한다", async () => {
  const f = fixture();
  await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" });
  const d = f.state.drafts[0];
  d.body = "<p>수정안</p>";
  f.approve(d);
  const release = f.pauseReads();
  const pending = [
    f.invoke("applyPostUpdate", d.id),
    f.invoke("applyPostUpdate", d.id),
  ];
  await new Promise(setImmediate);
  release();
  const results = await Promise.allSettled(pending);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.calls.filter((c) => c.method).length, 1);
});
test("쓰기 후 서버 원고가 수정안과 다르면 완료로 표시하지 않는다", async () => {
  const f = fixture();
  await f.invoke("openPostUpdate", { siteId: "s", remoteId: "44" });
  const d = f.state.drafts[0];
  d.body = "<p>수정안</p>";
  f.approve(d);
  f.alter = true;
  await assert.rejects(f.invoke("applyPostUpdate", d.id));
  assert.equal(d.status, "uncertain");
  assert.equal(f.calls.filter((c) => c.method).length, 1);
});
