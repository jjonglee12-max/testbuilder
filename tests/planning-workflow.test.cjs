const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
async function setup(
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-flow-")),
) {
  const calls = [],
    handlers = {};
  let holdReview = false,
    releaseReview,
    failReview = false,
    extraOutput = {};
  const mainDir = path.join(__dirname, "../electron");
  const fake = {
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => dir,
      on() {},
      requestSingleInstanceLock: () => true,
    },
    ipcMain: { handle: (k, f) => (handlers[k] = f) },
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "test",
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    BrowserWindow: class {
      constructor() {
        this.webContents = { setWindowOpenHandler() {}, on() {} };
      }
      loadFile() {}
    },
  };
  const sandbox = {
    require: (n) =>
      n === "electron"
        ? fake
        : n === "node:timers"
          ? { setInterval: () => ({ unref() {} }) }
          : n === "./sources.cjs"
            ? {
                collectSource: async (url) => {
                  if (url.includes("fail")) throw Error("수집 실패");
                  return {
                    id: "ref",
                    url,
                    title: "공식 자료",
                    text: "공식 도움말 내용입니다.",
                    contentHash: "hash",
                    fetchedAt: new Date().toISOString(),
                  };
                },
              }
            : n.startsWith("./")
              ? require(path.join(mainDir, n))
              : require(n),
    __dirname: mainDir,
    process,
    Buffer,
    URL,
    AbortSignal,
    console,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      let data, totalPages;
      if (url.startsWith("https://api.example.com")) {
        const payload = JSON.parse(options.body),
          reviewing = payload.messages[0].content.includes("별도의");
        if (reviewing) {
          if (holdReview) await new Promise((r) => (releaseReview = r));
          if (failReview) throw Error("AI review failed");
          data = {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "ready_for_human",
                    summary: "자료 범위 검토",
                    findings: [],
                    claims: [],
                  }),
                },
              },
            ],
          };
        } else {
          const input = JSON.parse(payload.messages[1].content);
          data = {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: input.topic + " 실무 안내",
                    body: "제공한 자료를 바탕으로 작성한 초안입니다.",
                    notes: "사람 확인 필요",
                    ...extraOutput,
                  }),
                },
              },
            ],
          };
        }
      } else if (url.includes("/categories"))
        data = [{ id: 3, name: "업무 AI" }];
      else if (url.includes("/tags")) data = [{ id: 9, name: "생산성" }];
      else if (
        url.startsWith("https://www.googleapis.com") &&
        options.method === "POST"
      ) {
        data = {
          id: "500",
          url: "http://example.blogspot.com/new.html",
          status: "LIVE",
        };
      } else if (url.startsWith("https://www.googleapis.com")) {
        const next = new URL(url).searchParams.get("pageToken");
        data = {
          items: [
            {
              id: next ? "b2" : "b1",
              title: next ? "추가 글" : "Blogger 공개 글",
              url:
                "http://example.blogspot.com/" + (next ? "b" : "a") + ".html",
              labels: ["AI", "업무"],
            },
          ],
          ...(next ? {} : { nextPageToken: "next" }),
        };
      } else if (options.method === "POST") {
        data = { id: 500, link: "https://example.com/new", status: "publish" };
      } else {
        const page = new URL(url).searchParams.get("page");
        data = [
          {
            id: page === "2" ? 102 : 101,
            title: { rendered: page === "2" ? "추가 글" : "회의록 정리 기준" },
            link: "https://example.com/" + (page === "2" ? "two" : "one"),
            categories: [3],
            tags: [9],
            date_gmt: "2026-10-01T00:00:00",
          },
        ];
        totalPages = "2";
      }
      return {
        ok: true,
        headers: { get: () => totalPages },
        json: async () => data,
      };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(mainDir, "main.cjs"), "utf8"),
    sandbox,
  );
  await new Promise((r) => setImmediate(r));
  const call = (k, v) => handlers[k]({}, v);
  return {
    dir,
    calls,
    call,
    hold: (v) => (holdReview = v),
    release: () => releaseReview?.(),
    fail: (v) => (failReview = v),
    extras: (v) => (extraOutput = v),
    waiting: () => !!releaseReview,
    until: async (fn) => {
      for (let i = 0; i < 100; i++) {
        if (fn()) return;
        await new Promise((r) => setImmediate(r));
      }
      throw Error("background did not finish");
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
async function site(c, type = "wordpress") {
  const s = c.call("saveSite", {
    name: "블로그",
    type,
    url: "https://example.com",
    username: "writer",
    blogId: "123",
    credential: "fake",
  }).sites[0];
  c.call("saveAI", {
    endpoint: "https://api.example.com/v1",
    model: "test",
    credential: "fake",
  });
  return s;
}
function plan(c, s, topic = "PDF 문서 요약") {
  const result = c.call("savePlan", {
    siteId: s.id,
    topic,
    type: "사용법·문제 해결",
    notes: "확인한 사실과 사용 기록입니다.",
    urls: [],
    sourceIds: [],
    categoryIds: s.type === "wordpress" ? [3] : [],
    tagIds: s.type === "wordpress" ? [9] : [],
    labels: s.type === "blogger" ? ["AI"] : [],
  });
  return result.plans[0];
}
test("WordPress 분류·기존 글 페이지→추천·중복 확인→실제 발행 분류 반영", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    let r = await c.call("syncPosts", { siteId: s.id, reset: true });
    assert.equal(r.count, 1);
    assert.equal(r.state.catalogs[s.id].postsComplete, false);
    r = await c.call("syncPosts", { siteId: s.id });
    assert.equal(r.state.posts.length, 2);
    assert.equal(r.state.catalogs[s.id].postsComplete, true);
    assert.equal(
      c.call("recommendLinks", { siteId: s.id, topic: "회의록 정리" }).links[0]
        .title,
      "회의록 정리 기준",
    );
    let d = c.call("saveDraft", {
      siteId: s.id,
      title: "새 글",
      body: "검토한 본문",
      categoryIds: [3],
      tagIds: [9],
    });
    c.call("approve", d.id);
    await c.call("publish", d.id);
    const payload = JSON.parse(
      c.calls.find(
        (v) => v.options.method === "POST" && v.url.includes("/wp-json/"),
      ).options.body,
    );
    assert.deepEqual(payload.categories, [3]);
    assert.deepEqual(payload.tags, [9]);
    assert.ok(
      c.call("load").posts.some((p) => p.url === "https://example.com/new"),
    );
  } finally {
    c.cleanup();
  }
});
test("Blogger 기존 라벨 제안과 실제 발행 labels 반영", async () => {
  const c = await setup();
  try {
    const s = await site(c, "blogger");
    let state = await c.call("syncTaxonomy", s.id);
    assert.deepEqual(Array.from(state.catalogs[s.id].labels), ["AI", "업무"]);
    assert.equal(state.posts[0].url, "https://example.blogspot.com/a.html");
    const r = await c.call("syncPosts", { siteId: s.id });
    assert.equal(r.state.posts.length, 2);
    const d = c.call("saveDraft", {
      siteId: s.id,
      title: "라벨 글",
      body: "본문",
      labels: ["AI", "문서"],
    });
    c.call("approve", d.id);
    await c.call("publish", d.id);
    const request = c.calls.find(
      (v) => v.url.includes("googleapis.com") && v.options.method === "POST",
    );
    assert.deepEqual(JSON.parse(request.options.body).labels, ["AI", "문서"]);
  } finally {
    c.cleanup();
  }
});
test("일괄 준비 중 편집·설정·승인 잠금, 단계 후 중지·재시작, 자동 발행 없음", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    const a = plan(c, s),
      b = plan(c, s, "이미지 편집 도구");
    c.hold(true);
    c.call("startBatch", { planIds: [a.id, b.id] });
    await c.until(() => c.waiting());
    const state = c.call("load"),
      d = state.drafts[0];
    assert.equal(state.plans.find((p) => p.id === a.id).stage, "review");
    assert.throws(() => c.call("approve", d.id), /일괄/);
    assert.throws(() => c.call("saveDraft", d), /일괄/);
    assert.throws(
      () =>
        c.call("saveAI", {
          endpoint: "https://api.example.com/v1",
          model: "new",
        }),
      /일괄/,
    );
    assert.throws(() => c.call("deletePlan", a.id), /중지/);
    c.call("stopBatch");
    c.hold(false);
    c.release();
    await c.until(() => c.call("load").batch.status === "stopped");
    assert.equal(c.call("load").drafts.length, 1);
    assert.equal(
      c.call("load").plans.find((p) => p.id === b.id).status,
      "idea",
    );
    c.call("startBatch", { planIds: [b.id] });
    await c.until(() => c.call("load").batch.status === "completed");
    assert.equal(c.call("load").drafts.length, 2);
    assert.ok(
      c.call("load").drafts.every((d) => d.status === "draft" && !d.approval),
    );
    assert.equal(
      c.calls.filter(
        (v) => v.url.includes("/wp-json/") && v.options.method === "POST",
      ).length,
      0,
    );
  } finally {
    c.cleanup();
  }
});
test("검토 실패 뒤 재개는 저장한 초안을 재사용, 기획 변경은 기존 원고 보존", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    const p = plan(c, s);
    c.fail(true);
    c.call("startBatch", { planIds: [p.id] });
    await c.until(() => c.call("load").batch.status === "stopped");
    const draftId = c.call("load").plans[0].draftId;
    assert.ok(draftId);
    const count = () =>
      c.calls.filter(
        (v) =>
          v.url.startsWith("https://api.example.com") &&
          !JSON.parse(v.options.body).messages[0].content.includes("별도의"),
      ).length;
    assert.equal(count(), 1);
    c.fail(false);
    c.call("startBatch", { planIds: [p.id] });
    await c.until(() => c.call("load").batch.status === "completed");
    assert.equal(count(), 1);
    assert.equal(c.call("load").plans[0].draftId, draftId);
    c.call("savePlan", { ...c.call("load").plans[0], notes: "새로운 자료" });
    assert.equal(c.call("load").plans[0].draftId, undefined);
    assert.ok(c.call("load").drafts.find((d) => d.id === draftId));
  } finally {
    c.cleanup();
  }
});
test("중복 경고 확인 없이 준비 차단, 앱 재시작 후 유료 작업 자동 재개 안 함", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    await c.call("syncPosts", { siteId: s.id, reset: true });
    const p = plan(c, s, "회의록 정리 기준");
    assert.throws(() => c.call("startBatch", { planIds: [p.id] }), /중복 경고/);
    const state = JSON.parse(
      fs.readFileSync(path.join(c.dir, "studio.json"), "utf8"),
    );
    state.batch = {
      id: "old",
      status: "running",
      planIds: [p.id],
      total: 1,
      done: 0,
    };
    state.plans[0].status = "running";
    fs.writeFileSync(path.join(c.dir, "studio.json"), JSON.stringify(state));
    const resumed = await setup(c.dir);
    assert.equal(resumed.call("load").batch.status, "interrupted");
    assert.equal(resumed.call("load").plans[0].status, "interrupted");
    assert.equal(resumed.calls.length, 0);
  } finally {
    c.cleanup();
  }
});

test("자료 수집 실패는 해당 기획만 실패, 후속 기획은 준비하되 발행 안 함", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    let a = plan(c, s, "실패 주제");
    c.call("savePlan", { ...a, notes: "", urls: ["https://fail.example.com"] });
    const b = plan(c, s, "스프레드시트 정리");
    c.call("startBatch", { planIds: [a.id, b.id] });
    await c.until(() => c.call("load").batch.status === "completed");
    const state = c.call("load");
    assert.equal(state.plans.find((p) => p.id === a.id).status, "failed");
    assert.equal(state.plans.find((p) => p.id === b.id).status, "ready");
    assert.equal(state.drafts.length, 1);
    assert.equal(state.batch.done, 2);
    assert.ok(!state.drafts[0].approval);
  } finally {
    c.cleanup();
  }
});

test("동일 기획끼리도 중복 허용 확인 전 유료 준비 차단", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    const a = plan(c, s, "같은 회의록 주제"),
      b = plan(c, s, "같은 회의록 주제");
    assert.throws(
      () => c.call("startBatch", { planIds: [a.id, b.id] }),
      /중복 경고/,
    );
    assert.equal(
      c.calls.filter((v) => v.url.startsWith("https://api.example.com")).length,
      0,
    );
  } finally {
    c.cleanup();
  }
});

test("발행 인증 없이도 메모 기반 일괄 초안 준비 가능, 블로그 API 호출 없음", async () => {
  const c = await setup();
  try {
    const s = c.call("saveSite", {
      name: "준비할 블로그",
      type: "wordpress",
      url: "https://example.com",
      username: "writer",
    }).sites[0];
    c.call("saveAI", {
      endpoint: "https://api.example.com/v1",
      model: "test",
      credential: "fake",
    });
    const p = c.call("savePlan", {
      siteId: s.id,
      topic: "문서 업무",
      notes: "직접 확인한 메모",
      urls: [],
      sourceIds: [],
    }).plans[0];
    c.call("startBatch", { planIds: [p.id] });
    await c.until(() => c.call("load").batch.status === "completed");
    assert.equal(c.call("load").drafts.length, 1);
    assert.ok(
      c.calls.every((v) => v.url.startsWith("https://api.example.com")),
    );
  } finally {
    c.cleanup();
  }
});

test("일괄 생성 응답의 임의 ID·대상·승인 필드가 기존 원고나 발행 설정을 바꾸지 못함", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    await c.call("syncTaxonomy", s.id);
    const existing = c.call("saveDraft", {
      siteId: s.id,
      title: "보존할 원고",
      body: "기존 본문",
    });
    c.extras({
      id: existing.id,
      siteId: "other",
      publication: { mode: "remote", at: "2030-01-01T00:00:00Z" },
      status: "published",
      approval: { hash: "fake" },
      categoryIds: [999],
    });
    const p = plan(c, s, "새 문서 작업");
    c.call("startBatch", { planIds: [p.id] });
    await c.until(() => c.call("load").batch.status === "completed");
    const state = c.call("load");
    assert.equal(
      state.drafts.find((d) => d.id === existing.id).body,
      "기존 본문",
    );
    const generated = state.drafts.find((d) => d.planId === p.id);
    assert.notEqual(generated.id, existing.id);
    assert.equal(generated.siteId, s.id);
    assert.equal(generated.publication.mode, "now");
    assert.equal(generated.status, "draft");
    assert.equal(generated.approval, undefined);
    assert.deepEqual(Array.from(generated.categoryIds), [3]);
  } finally {
    c.cleanup();
  }
});
