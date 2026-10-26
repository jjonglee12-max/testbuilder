const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const C = require("../electron/codex.cjs");
async function setup(t, saved) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-codex-flow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (saved)
    fs.writeFileSync(path.join(dir, "studio.json"), JSON.stringify(saved));
  const handlers = {},
    calls = [];
  let network = 0;
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
  vm.runInNewContext(fs.readFileSync(path.join(mainDir, "main.cjs"), "utf8"), {
    require: (n) =>
      n === "electron"
        ? fake
        : n === "node:timers"
          ? { setInterval: () => ({ unref() {} }) }
          : n === "./codex.cjs"
            ? {
                ...C,
                createCodex: (opts) =>
                  C.createCodex({
                    ...opts,
                    resolve: () => process.execPath,
                    spawnProcess: (exe, args, options) => {
                      calls.push(args);
                      return spawn(
                        process.execPath,
                        [
                          path.join(__dirname, "fixtures/fake-codex.cjs"),
                          ...args,
                        ],
                        options,
                      );
                    },
                  }),
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
    fetch: async () => {
      network++;
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          id: "44",
          status: "LIVE",
          title: "기존 글",
          content: "<p>원문</p>",
          url: "https://example.com/44",
          updated: "2026-10-01T00:00:00Z",
          published: "2025-01-01T00:00:00Z",
        }),
      };
    },
  });
  await new Promise(setImmediate);
  const invoke = async (k, v) => handlers[k](null, v);
  return {
    dir,
    calls,
    invoke,
    get network() {
      return network;
    },
    async connect() {
      await invoke("saveCodex", { executable: "", model: "", webSearch: true });
      await invoke("testCodex");
      return invoke("setAIEngine", "codex");
    },
  };
}
async function wait(f, predicate) {
  for (let i = 0; i < 150; i++) {
    const s = await f.invoke("load");
    if (predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("job did not complete");
}
test("Codex 엔진으로 API 키 없이 초안→저장→별도 검토→사람 승인, 기존 AI API는 호출하지 않음", async (t) => {
  const f = await setup(t);
  await f.invoke("saveSite", {
    name: "AI 블로그",
    type: "blogger",
    blogId: "12",
  });
  await f.connect();
  const s = await f.invoke("load"),
    siteId = s.sites[0].id,
    r = await f.invoke("generate", {
      siteId,
      topic: "AI 업무",
      type: "안내",
      sources: "참고 메모",
      sourceIds: [],
    });
  assert.equal(r.generation.model, "codex/default");
  const d = await f.invoke("saveDraft", {
    siteId,
    title: r.title,
    body: r.body,
    generation: r.generation,
    sourceIds: [],
  });
  await assert.rejects(f.invoke("approve", d.id), /별도 AI 검토/);
  const reviewed = await f.invoke("reviewDraft", d.id);
  assert.equal(reviewed.drafts[0].review.model, "codex/default");
  assert.equal(reviewed.drafts[0].reviewCurrent, true);
  const approved = await f.invoke("approve", d.id);
  assert.equal(approved.drafts[0].status, "approved");
  assert.equal(f.network, 0);
  assert.equal(f.calls.filter((a) => a.includes("--json")).length, 2);
});
test("자연어 결과는 원고·발행을 자동 변경하지 않고 명시적으로 새 원고를 한 번 가져온다", async (t) => {
  const f = await setup(t);
  await f.invoke("saveSite", { name: "AI", type: "blogger", blogId: "12" });
  await f.connect();
  const siteId = (await f.invoke("load")).sites[0].id;
  const started = await f.invoke("startCodexTask", {
    siteId,
    request: "주제와 초안을 준비해줘",
    sourceIds: [],
    webSearch: true,
  });
  assert.equal(started.codexJob.status, "running");
  await assert.rejects(f.invoke("setAIEngine", "api"), /Codex/);
  let s = await wait(f, (s) => s.codexJob.status === "completed");
  assert.equal(s.drafts.length, 0);
  const r = await f.invoke("importCodexDraft", s.codexJob.id);
  const d = r.state.drafts[0];
  assert.equal(d.status, "draft");
  assert.equal(d.approval, undefined);
  assert.ok(d.sources.includes("보관 자료로 수집"));
  assert.ok(d.generation.model.startsWith("codex/"));
  assert.equal(
    (await f.invoke("importCodexDraft", s.codexJob.id)).draftId,
    d.id,
  );
  assert.equal((await f.invoke("load")).drafts.length, 1);
  await assert.rejects(f.invoke("approve", d.id), /별도 AI 검토/);
  assert.equal(f.network, 0);
});
test("Codex 미연결 자연어 요청은 즉시 오류를 반환하고 이전 결과를 실행 중으로 오인하지 않는다", async (t) => {
  const f = await setup(t);
  await f.invoke("saveSite", { name: "AI", type: "blogger", blogId: "12" });
  const s = await f.invoke("load");
  await assert.rejects(
    f.invoke("startCodexTask", { siteId: s.sites[0].id, request: "작성해줘" }),
    /로그인/,
  );
  assert.equal((await f.invoke("load")).codexJob, undefined);
});
test("일괄 준비도 Codex 엔진에서 API 키 없이 초안·별도 검토까지만 수행한다", async (t) => {
  const f = await setup(t);
  await f.invoke("saveSite", { name: "AI", type: "blogger", blogId: "12" });
  await f.connect();
  const siteId = (await f.invoke("load")).sites[0].id;
  const plans = await f.invoke("savePlan", {
    siteId,
    topic: "업무 AI 안내",
    notes: "확인한 메모",
    sourceIds: [],
  });
  await f.invoke("startBatch", { planIds: [plans.plans[0].id] });
  const s = await wait(f, (s) =>
    ["completed", "failed"].includes(s.batch?.status),
  );
  assert.equal(s.batch.status, "completed");
  assert.equal(s.plans[0].status, "ready");
  assert.equal(s.drafts[0].status, "draft");
  assert.ok(s.drafts[0].review);
  assert.equal(s.drafts[0].approval, undefined);
  assert.equal(f.network, 0);
});
test("기존 게시글 AI 수정도 선택한 Codex로 실행하고 원격 쓰기를 하지 않는다", async (t) => {
  const f = await setup(t);
  await f.invoke("saveSite", {
    name: "AI",
    type: "blogger",
    blogId: "12",
    credential: "token",
  });
  await f.connect();
  const siteId = (await f.invoke("load")).sites[0].id;
  const opened = await f.invoke("openPostUpdate", { siteId, remoteId: "44" });
  const s = await f.invoke("suggestPostUpdate", {
      id: opened.draftId,
      instruction: "공식 설명에 맞춰 개선",
    }),
    d = s.drafts.find((d) => d.id === opened.draftId);
  assert.equal(d.updateTarget.remoteId, "44");
  assert.equal(d.generation.model, "codex/default");
  assert.equal(d.status, "draft");
  assert.equal(f.network, 1);
});
test("재시작 시 Codex 작업은 중단 상태로 바뀌며 프로세스·유료 작업을 재개하지 않는다", async (t) => {
  const f = await setup(t, {
    drafts: [],
    sites: [],
    ai: { endpoint: "https://api.example.com", model: "test" },
    codexJob: { id: "old", status: "running", kind: "task" },
    prompt: "지침",
  });
  const s = await f.invoke("load");
  assert.equal(s.codexJob.status, "interrupted");
  assert.equal(f.calls.length, 0);
  assert.equal(f.network, 0);
});
