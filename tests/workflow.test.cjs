const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
test("데스크톱 저장→승인→변경 무효화→발행·불확실 결과 복구", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-workflow-"));
  const handlers = {};
  let remoteCalls = 0,
    fail = false;
  const electron = {
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => dir,
      on: () => {},
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
  const sandbox = {
    require: (n) =>
      n === "electron"
        ? electron
        : n === "./core.cjs"
          ? require("../electron/core.cjs")
          : require(n),
    __dirname: mainDir,
    process,
    Buffer,
    URL,
    AbortSignal,
    console,
    fetch: async () => {
      remoteCalls++;
      if (fail) throw Error("network disconnected");
      return {
        ok: true,
        json: async () => ({ id: 123, link: "https://example.com/posts/123" }),
      };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(mainDir, "main.cjs"), "utf8"),
    sandbox,
  );
  await new Promise((r) => setImmediate(r));
  const call = (name, arg) => handlers[name]({}, arg);
  try {
    await call("saveSite", {
      name: "테스트",
      type: "wordpress",
      url: "https://example.com",
      username: "writer",
      credential: "test-not-real",
    });
    const publicState = call("load");
    assert.equal(publicState.sites[0].secret, undefined);
    assert.equal(publicState.sites[0].hasSecret, true);
    let d = call("saveDraft", {
      title: "제목",
      body: "검토한 본문",
      siteId: publicState.sites[0].id,
    });
    await assert.rejects(async () => call("publish", d.id), /승인/);
    assert.equal(remoteCalls, 0);
    call("approve", d.id);
    d = call("saveDraft", { ...d, body: "수정한 본문" });
    assert.equal(d.status, "draft");
    await assert.rejects(async () => call("publish", d.id), /승인/);
    call("approve", d.id);
    const result = await call("publish", d.id);
    assert.equal(result.drafts[0].status, "published");
    await assert.rejects(async () => call("publish", d.id), /결과 확인/);
    assert.equal(remoteCalls, 1);
    let second = call("saveDraft", {
      title: "다른 글",
      body: "검토한 본문",
      siteId: publicState.sites[0].id,
    });
    call("approve", second.id);
    fail = true;
    await assert.rejects(async () => call("publish", second.id), /중복/);
    assert.equal(call("load").drafts[0].status, "uncertain");
    await assert.rejects(async () => call("publish", second.id), /결과 확인/);
    assert.equal(remoteCalls, 2);
    call("reconcile", { id: second.id, url: "" });
    assert.equal(call("load").drafts[0].status, "draft");
    assert.equal(call("load").drafts[0].approval, undefined);
    const disk = JSON.parse(
      fs.readFileSync(path.join(dir, "studio.json"), "utf8"),
    );
    assert.equal(disk.drafts.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
