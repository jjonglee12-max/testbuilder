const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=";
async function setup({
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-flow-")),
  clock = Date.now(),
} = {}) {
  const calls = [],
    handlers = {},
    posts = new Map();
  let tick,
    now = clock,
    nextId = 200,
    failAt = "";
  const mainDir = path.join(__dirname, "../electron");
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
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
    nativeImage: {
      createFromBuffer: () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 1, height: 1 }),
        resize: () => ({ toDataURL: () => png }),
      }),
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
          ? {
              setInterval: (fn) => {
                tick = fn;
                return { unref() {} };
              },
            }
          : n.startsWith("./")
            ? require(path.join(mainDir, n))
            : require(n),
    __dirname: mainDir,
    process,
    Buffer,
    URL,
    Date: Clock,
    AbortSignal,
    console,
    fetch: async (url, options = {}) => {
      const method = options.method || "GET";
      calls.push({ url, method, options });
      if (failAt && url.includes(failAt)) throw Error("connection lost");
      const u = new URL(url);
      let result;
      if (u.pathname.endsWith("/media"))
        result = {
          id: 100,
          source_url: "https://example.com/uploads/photo.png",
        };
      else if (u.pathname.includes("/media/")) result = { id: 100 };
      else if (u.pathname.endsWith("/posts") && method === "POST") {
        const payload = JSON.parse(options.body);
        const id = String(nextId++);
        result = {
          id,
          link: "https://example.com/posts/" + id,
          url: "https://example.com/posts/" + id,
          status:
            u.hostname === "www.googleapis.com"
              ? u.searchParams.get("isDraft") === "true"
                ? "DRAFT"
                : "LIVE"
              : payload.status,
        };
        posts.set(id, result);
      } else {
        const match = u.pathname.match(
          /\/posts\/([^/]+)(?:\/(publish|revert))?$/,
        );
        if (!match) throw Error("Unexpected URL " + url);
        const [id, action] = match.slice(1);
        result = { ...posts.get(id) };
        if (method === "POST") {
          if (action === "publish")
            result.status = u.searchParams.has("publishDate")
              ? "SCHEDULED"
              : "LIVE";
          else if (action === "revert") result.status = "DRAFT";
          else result.status = JSON.parse(options.body).status;
          posts.set(id, result);
        }
      }
      return { ok: true, json: async () => result };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(mainDir, "main.cjs"), "utf8"),
    sandbox,
  );
  await new Promise((r) => setImmediate(r));
  return {
    dir,
    calls,
    posts,
    call: (k, v) => handlers[k]({}, v),
    setClock: (v) => (now = v),
    now: () => now,
    runTick: async () => {
      await tick();
    },
    fail: (v) => (failAt = v),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
async function site(ctx, type = "wordpress") {
  return ctx.call("saveSite", {
    name: "테스트",
    type,
    url: "https://example.com",
    username: "writer",
    blogId: "1234",
    credential: "fake",
  }).sites[0];
}
function draft(site, publication = { mode: "now" }, images = []) {
  return {
    title: "승인한 글",
    body: "출처 https://example.com/docs",
    siteId: site.id,
    publication,
    images,
  };
}
test("WordPress 이미지 업로드·메타·대표 이미지·UTC 예약 등록과 취소", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    const imported = c.call("importImage", { name: "photo.png", dataUrl: png });
    assert.ok(
      fs.existsSync(path.join(c.dir, "media", imported.assetId + ".png")),
    );
    const image = {
      id: "i",
      assetId: imported.assetId,
      alt: "AI 도구 화면",
      caption: "실제 화면",
      featured: true,
      position: "top",
    };
    assert.throws(
      () =>
        c.call("saveDraft", draft(s, { mode: "now" }, [{ ...image, alt: "" }])),
      /대체/,
    );
    let d = c.call(
      "saveDraft",
      draft(
        s,
        { mode: "remote", at: new Date(c.now() + 3600000).toISOString() },
        [image],
      ),
    );
    c.call("approve", d.id);
    let result = await c.call("scheduleDraft", d.id);
    assert.equal(result.drafts[0].status, "remote_scheduled");
    const create = c.calls.find(
      (v) => v.url.endsWith("/posts") && v.method === "POST",
    );
    const payload = JSON.parse(create.options.body);
    assert.equal(payload.status, "future");
    assert.equal(payload.date_gmt, d.publication.at.replace(/\.\d{3}Z$/, ""));
    assert.equal(payload.featured_media, 100);
    assert.ok(
      payload.content.includes("https://example.com/uploads/photo.png"),
    );
    assert.ok(
      c.calls.some(
        (v) =>
          v.url.endsWith("/media/100") &&
          JSON.parse(v.options.body).alt_text === "AI 도구 화면",
      ),
    );
    await assert.rejects(() => c.call("scheduleDraft", d.id), /결과 확인/);
    assert.throws(() => c.call("saveDraft", d), /수정/);
    result = await c.call("cancelSchedule", d.id);
    assert.equal(result.drafts[0].status, "draft");
    assert.equal(c.posts.get("200").status, "draft");
    d = c.call("saveDraft", {
      ...result.drafts[0],
      publication: { mode: "now" },
    });
    c.call("approve", d.id);
    await c.call("publish", d.id);
    assert.equal(c.calls.filter((v) => v.url.endsWith("/media")).length, 1);
  } finally {
    c.cleanup();
  }
});
test("Blogger는 외부 이미지와 초안 생성→예약 publish API 사용, 취소는 revert", async () => {
  const c = await setup();
  try {
    const s = await site(c, "blogger");
    const at = new Date(c.now() + 3600000).toISOString();
    const d = c.call(
      "saveDraft",
      draft(s, { mode: "remote", at }, [
        {
          id: "external",
          url: "https://example.com/photo.png",
          alt: "설명",
          position: "bottom",
        },
      ]),
    );
    c.call("approve", d.id);
    const result = await c.call("scheduleDraft", d.id);
    assert.equal(result.drafts[0].status, "remote_scheduled");
    assert.ok(c.calls[0].url.endsWith("/posts?isDraft=true"));
    assert.equal(new URL(c.calls[1].url).searchParams.get("publishDate"), at);
    assert.ok(JSON.parse(c.calls[0].options.body).content.includes("<figure>"));
    await c.call("cancelSchedule", d.id);
    assert.ok(c.calls.at(-1).url.endsWith("/revert"));
    assert.ok(
      c.calls.some(
        (v) =>
          v.method === "GET" &&
          new URL(v.url).searchParams.get("view") === "ADMIN",
      ),
    );
    const imported = c.call("importImage", { name: "photo.png", dataUrl: png });
    const local = c.call(
      "saveDraft",
      draft(s, { mode: "now" }, [
        { id: "local", assetId: imported.assetId, alt: "사진" },
      ]),
    );
    assert.throws(() => c.call("approve", local.id), /Blogger/);
  } finally {
    c.cleanup();
  }
});
test("로컬 예약은 승인·예약 등록 후에만 실행하고 한 번만 게시", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    const at = new Date(c.now() + 90000).toISOString();
    const d = c.call("saveDraft", draft(s, { mode: "local", at }));
    await assert.rejects(() => c.call("scheduleDraft", d.id), /승인/);
    c.call("approve", d.id);
    await c.call("scheduleDraft", d.id);
    assert.equal(c.call("load").drafts[0].status, "queued");
    assert.equal(c.calls.length, 0);
    await c.runTick();
    assert.equal(c.calls.length, 0);
    c.setClock(c.now() + 100000);
    await c.runTick();
    assert.equal(c.call("load").drafts[0].status, "published");
    await c.runTick();
    assert.equal(c.calls.filter((v) => v.url.endsWith("/posts")).length, 1);
  } finally {
    c.cleanup();
  }
});
test("앱 재시작 전에 지난 로컬 예약은 발행하지 않고 보류", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    const d = c.call(
      "saveDraft",
      draft(s, { mode: "local", at: new Date(c.now() + 90000).toISOString() }),
    );
    c.call("approve", d.id);
    await c.call("scheduleDraft", d.id);
    const resumed = await setup({ dir: c.dir, clock: c.now() + 100000 });
    assert.equal(resumed.call("load").drafts[0].status, "missed");
    await resumed.runTick();
    assert.equal(resumed.calls.length, 0);
    await resumed.call("cancelSchedule", d.id);
    assert.equal(resumed.call("load").drafts[0].status, "approved");
  } finally {
    c.cleanup();
  }
});
test("게시 요청 전 업로드 실패는 승인 상태 복귀, 게시 결과 불명은 재시도 차단", async () => {
  const c = await setup();
  try {
    const s = await site(c),
      asset = c.call("importImage", { name: "a.png", dataUrl: png });
    const d = c.call(
      "saveDraft",
      draft(s, { mode: "now" }, [
        { id: "i", assetId: asset.assetId, alt: "사진" },
      ]),
    );
    c.call("approve", d.id);
    c.fail("/media");
    await assert.rejects(() => c.call("publish", d.id), /이미지 준비/);
    assert.equal(c.call("load").drafts[0].status, "approved");
    assert.equal(c.calls.filter((v) => v.url.endsWith("/posts")).length, 0);
    c.fail("/posts");
    await assert.rejects(() => c.call("publish", d.id), /중복/);
    assert.equal(c.call("load").drafts[0].status, "uncertain");
    const count = c.calls.length;
    await assert.rejects(() => c.call("publish", d.id), /결과 확인/);
    assert.equal(c.calls.length, count);
  } finally {
    c.cleanup();
  }
});
test("Blogger 예약 확정 실패 후 원격 ID 보존·조회, 임박한 예약 취소 차단", async () => {
  const c = await setup();
  try {
    const s = await site(c, "blogger");
    let d = c.call(
      "saveDraft",
      draft(s, {
        mode: "remote",
        at: new Date(c.now() + 3600000).toISOString(),
      }),
    );
    c.call("approve", d.id);
    c.fail("/publish?");
    await assert.rejects(() => c.call("scheduleDraft", d.id), /중복/);
    let state = c.call("load");
    assert.equal(state.drafts[0].remote.id, "200");
    assert.equal(state.drafts[0].status, "uncertain");
    c.fail("");
    state = await c.call("refreshRemote", d.id);
    assert.equal(state.drafts[0].status, "draft");
    d = c.call(
      "saveDraft",
      draft(s, { mode: "remote", at: new Date(c.now() + 90000).toISOString() }),
    );
    c.call("approve", d.id);
    await c.call("scheduleDraft", d.id);
    const before = c.calls.length;
    await assert.rejects(() => c.call("cancelSchedule", d.id), /2분/);
    assert.equal(c.calls.length, before);
    c.posts.get("201").status = "LIVE";
    state = await c.call("refreshRemote", d.id);
    assert.equal(state.drafts[0].status, "published");
  } finally {
    c.cleanup();
  }
});

test("실행 중 5분 넘겨 지난 로컬 예약은 자동 게시하지 않음", async () => {
  const c = await setup();
  try {
    const s = await site(c);
    const d = c.call(
      "saveDraft",
      draft(s, { mode: "local", at: new Date(c.now() + 90000).toISOString() }),
    );
    c.call("approve", d.id);
    await c.call("scheduleDraft", d.id);
    c.setClock(c.now() + 450000);
    await c.runTick();
    assert.equal(c.call("load").drafts[0].status, "missed");
    assert.equal(c.calls.length, 0);
  } finally {
    c.cleanup();
  }
});
