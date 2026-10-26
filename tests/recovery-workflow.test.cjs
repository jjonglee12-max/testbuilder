const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
async function setup(t, corrupt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-flow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (corrupt) fs.writeFileSync(path.join(dir, "studio.json"), corrupt);
  const handlers = {},
    calls = [];
  const electron = {
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
  const mainDir = path.join(__dirname, "../electron");
  vm.runInNewContext(fs.readFileSync(path.join(mainDir, "main.cjs"), "utf8"), {
    require: (n) =>
      n === "electron"
        ? electron
        : n === "node:timers"
          ? { setInterval: () => ({ unref() {} }) }
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
      calls.push({ url, ...options });
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          id: "44",
          status: "LIVE",
          title: "원문",
          content: "<p>원격 원문</p>",
          url: "https://example.com/44",
          updated: "2026-10-01T00:00:00Z",
          published: "2025-01-01T00:00:00Z",
        }),
      };
    },
  });
  await new Promise(setImmediate);
  return { dir, calls, invoke: (k, v) => handlers[k](null, v) };
}
test("실제 IPC 저장 경로는 수정 대상 위조를 무시하고 HTML 수정본의 새 발행·예약·대상 변경을 차단한다", async (t) => {
  const f = await setup(t);
  await f.invoke("saveSite", {
    name: "테스트",
    type: "blogger",
    blogId: "12",
    credential: "token",
  });
  const state = await f.invoke("load"),
    siteId = state.sites[0].id;
  const fake = await f.invoke("saveDraft", {
    siteId,
    title: "일반 원고",
    body: "내용",
    format: "html",
    updateTarget: { remoteId: "999" },
    publication: { mode: "now" },
  });
  assert.equal(fake.format, "markdown");
  assert.equal(fake.updateTarget, undefined);
  const opened = await f.invoke("openPostUpdate", { siteId, remoteId: "44" }),
    d = opened.state.drafts.find((v) => v.id === opened.draftId);
  assert.equal(d.format, "html");
  const saved = await f.invoke("saveDraft", {
    ...d,
    title: "수정 제목",
    updateTarget: { ...d.updateTarget, remoteId: "999" },
  });
  assert.equal(saved.updateTarget.remoteId, "44");
  await assert.rejects(
    Promise.resolve().then(() =>
      f.invoke("saveDraft", { ...saved, siteId: "other" }),
    ),
    /사이트/,
  );
  await assert.rejects(
    Promise.resolve().then(() => f.invoke("scheduleDraft", saved.id)),
    /예약할 수 없/,
  );
  await assert.rejects(
    Promise.resolve().then(() => f.invoke("publish", saved.id)),
    /기존 글/,
  );
  assert.equal(f.calls.filter((c) => c.method).length, 0);
  const revisions = await f.invoke("listRevisions", saved.id);
  assert.equal(revisions.length, 2);
  const restored = await f.invoke("restoreRevision", revisions[1].id);
  assert.notEqual(restored.draftId, d.id);
  assert.equal(
    restored.state.drafts.find((v) => v.id === restored.draftId).body,
    "<p>원격 원문</p>",
  );
});
test("손상되거나 배열 구조가 잘못된 저장 파일은 원본을 보존하고 복구 안내를 제공한다", async (t) => {
  for (const raw of [
    "{broken",
    JSON.stringify({ drafts: {}, sites: [], ai: {} }),
  ]) {
    const f = await setup(t, raw),
      s = await f.invoke("load");
    assert.ok(s.recovery);
    assert.equal(
      fs.readFileSync(path.join(f.dir, s.recovery.file), "utf8"),
      raw,
    );
    assert.deepEqual(Array.from(s.drafts), []);
  }
});
