const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
test("자료 부분 실패→사이트별 생성→별도 검토→승인·변경 감지 통합", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editorial-workflow-"));
  const handlers = {},
    calls = [];
  let version = 1,
    block = false,
    hold = false,
    release,
    started;
  const mainDir = path.join(__dirname, "../electron");
  const fake = {
    app: { whenReady: () => Promise.resolve(), getPath: () => dir, on() {} },
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
        : n === "./sources.cjs"
          ? {
              collectSource: async (url) => {
                if (url.includes("fail")) throw Error("수집 실패");
                return {
                  id: "ref" + version,
                  url,
                  title: "공식 자료",
                  text: "기능은 문서 처리입니다.",
                  fetchedAt: new Date().toISOString(),
                  contentHash: "hash" + version,
                  truncated: false,
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
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      const reviewing =
        payload.messages[0].content.includes("별도의 AI 블로그 검토자");
      if (reviewing && hold) {
        started();
        await new Promise((r) => (release = r));
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  reviewing
                    ? {
                        verdict: "ready_for_human",
                        summary: "제공된 자료 범위 검토",
                        findings: block
                          ? [{ severity: "blocker", message: "근거 없음" }]
                          : [],
                        claims: [
                          {
                            claim: "문서 처리",
                            status: "supported",
                            sourceIds: ["ref1"],
                            reason: "본문",
                          },
                        ],
                      }
                    : {
                        title: "도구 소개",
                        body: "문서 처리를 돕습니다.",
                        notes: "사람 확인",
                      },
                ),
              },
            },
          ],
        }),
      };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(mainDir, "main.cjs"), "utf8"),
    sandbox,
  );
  await new Promise((r) => setImmediate(r));
  const call = (k, v) => handlers[k]({}, v);
  try {
    call("saveAI", {
      endpoint: "https://api.example.com/v1",
      model: "test",
      credential: "fake",
    });
    const s = call("saveSite", {
      name: "업무 AI",
      type: "wordpress",
      url: "https://example.com",
      username: "writer",
      credential: "fake",
      profile: {
        topic: "업무 AI",
        audience: "초보 직장인",
        tone: "친근한 존댓말",
        instructions: "단계별 예시",
      },
    }).sites[0];
    const collection = await call("collectSources", {
      urls: "https://example.com/docs\nhttps://fail.example.com",
    });
    assert.equal(collection.ids.length, 1);
    assert.equal(collection.errors.length, 1);
    assert.equal(call("load").sources.length, 1);
    await call("collectSources", { urls: "https://example.com/docs" });
    assert.equal(call("load").sources.length, 1);
    version = 2;
    await call("collectSources", { urls: "https://example.com/docs" });
    assert.equal(call("load").sources.length, 2);
    const input = {
      topic: "AI 도구",
      type: "도구 소개",
      siteId: s.id,
      sourceIds: ["ref1"],
      sources: "사용 기록 없음",
    };
    const generated = await call("generate", input);
    const context = JSON.parse(calls.at(-1).messages[1].content);
    assert.equal(context.siteProfile.audience, "초보 직장인");
    assert.equal(context.evidence[0].contentHash, "hash1");
    assert.equal(generated.generation.sourceIds[0], "ref1");
    let d = call("saveDraft", { ...input, ...generated });
    assert.throws(() => call("approve", d.id), /별도 AI 검토/);
    await call("reviewDraft", d.id);
    let state = call("load");
    assert.equal(state.drafts[0].reviewCurrent, true);
    assert.equal(state.drafts[0].review.claims[0].status, "supported");
    assert.equal(
      calls.at(-1).messages[0].content.includes("별도의 AI 블로그 검토자"),
      true,
    );
    assert.doesNotThrow(() => call("approve", d.id));
    d = call("saveDraft", { ...state.drafts[0], body: "수정된 원고" });
    assert.equal(d.reviewCurrent, false);
    assert.throws(() => call("approve", d.id), /변경/);
    block = true;
    await call("reviewDraft", d.id);
    assert.throws(() => call("approve", d.id), /수정 필요/);
    block = false;
    hold = true;
    const start = new Promise((r) => (started = r));
    const pending = call("reviewDraft", d.id);
    await start;
    call("saveDraft", { ...d, body: "검토 중 변경" });
    release();
    await assert.rejects(() => pending, /검토 중/);
    hold = false;
    await call("reviewDraft", d.id);
    call("saveSite", { ...s, profile: { audience: "전문가" } });
    assert.equal(call("load").drafts[0].reviewCurrent, false);
    assert.throws(() => call("approve", d.id), /변경/);
    const disk = JSON.parse(
      fs.readFileSync(path.join(dir, "studio.json"), "utf8"),
    );
    assert.equal(disk.sources.length, 2);
    assert.equal(disk.drafts[0].review.model, "test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
