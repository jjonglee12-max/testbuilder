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
  let aiStatus = 200;
  const aiCalls = [];
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
      if (url.startsWith("https://api.example.com/")) {
        aiCalls.push({ url, options });
        return {
          ok: aiStatus === 200,
          status: aiStatus,
          json: async () =>
            url.endsWith("/models")
              ? { data: [{ id: "test-model" }] }
              : {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          title: "생성 제목",
                          body: "자료에 따른 본문",
                          notes: "출처 확인",
                        }),
                      },
                    },
                  ],
                },
        };
      }
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
    assert.equal(call("load").workspace.name, "개인 워크스페이스");
    call("saveWorkspace", { name: "AI 연구 노트" });
    assert.equal(call("load").workspace.name, "AI 연구 노트");
    assert.throws(() => call("saveWorkspace", { name: " " }), /1~40/);
    const config = {
      endpoint: "https://api.example.com/v1/chat/completions",
      model: "test-model",
      credential: "fake-test-key",
    };
    assert.throws(
      () => call("saveAI", { ...config, credential: "" }),
      /API 키/,
    );
    assert.throws(() => call("saveAI", { ...config, model: "" }), /모델/);
    call("saveAI", config);
    const saved = call("load").ai;
    assert.equal(saved.endpoint, "https://api.example.com/v1");
    assert.equal(saved.secret, undefined);
    assert.equal(saved.hasSecret, true);
    assert.deepEqual(
      Array.from(await call("listAIModels", { ...config, credential: "" })),
      ["test-model"],
    );
    await call("testAI", config);
    assert.ok(call("load").ai.testedAt);
    assert.equal(
      aiCalls.at(-1).options.headers.Authorization,
      "Bearer fake-test-key",
    );
    const generated = await call("generate", {
      topic: "테스트",
      type: "도구 소개",
      sources: "확인한 사실",
    });
    assert.equal(generated.title, "생성 제목");
    assert.equal(generated.generation.model, "test-model");
    aiStatus = 401;
    await assert.rejects(() => call("testAI", config), /API 키/);
    aiStatus = 429;
    await assert.rejects(() => call("testAI", config), /한도/);
    assert.throws(
      () =>
        call("saveAI", {
          endpoint: "https://other.example.com/v1",
          model: "x",
          credential: "",
        }),
      /새로 입력/,
    );
    call("saveAI", { ...config, model: "different" });
    assert.equal(call("load").ai.testedAt, undefined);
    const disk = JSON.parse(
      fs.readFileSync(path.join(dir, "studio.json"), "utf8"),
    );
    assert.equal(disk.drafts.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
