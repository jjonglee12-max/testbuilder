const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  createCodex,
  resolveExecutable,
  nativeCandidates,
  cleanEnv,
  DRAFT_SCHEMA,
  TASK_SCHEMA,
} = require("../electron/codex.cjs");
function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-codex-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = {
    codex: { executable: "", model: "", webSearch: true },
    sites: [{ secret: "SITE_SECRET" }],
    ai: { secret: "AI_SECRET" },
  };
  const calls = [];
  const runner = createCodex({
    getState: () => state,
    persist() {},
    dir,
    resolve: () => process.execPath,
    spawnProcess: (exe, args, opts) => {
      calls.push({ exe, args, opts });
      return spawn(
        process.execPath,
        [path.join(__dirname, "fixtures/fake-codex.cjs"), ...args],
        opts,
      );
    },
    ...extra,
  });
  return { state, runner, calls, dir };
}
test("Codex 연결 확인은 CLI 버전·기능·로그인만 조회하며 모델 호출을 하지 않는다", async (t) => {
  const f = fixture(t),
    r = await f.runner.test();
  assert.equal(r.loggedIn, true);
  assert.equal(r.auth, "ChatGPT 로그인");
  assert.equal(f.calls.length, 3);
  assert.deepEqual(
    f.calls.map((c) => c.args[0]),
    ["--version", "exec", "login"],
  );
  assert.equal(f.state.codexJob, undefined);
});
test("작업은 stdin·스키마·읽기 전용으로 실행하며 블로그 인증과 개인 환경 키를 전달하지 않는다", async (t) => {
  const f = fixture(t);
  await f.runner.test();
  const result = await f.runner.run({
    messages: [{ role: "user", content: "작성해줘" }],
  });
  assert.equal(result.value.title, "Codex 초안");
  assert.equal(f.state.codexJob.status, "completed");
  const c = f.calls.at(-1);
  assert.equal(c.opts.shell, false);
  assert.equal(c.args[c.args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(c.args.includes("features.shell_tool=false"));
  assert.ok(c.args.includes("features.apps=false"));
  assert.ok(c.args.includes("--ignore-user-config"));
  assert.ok(c.args.includes('web_search="disabled"'));
  assert.ok(!c.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(c.opts.env.OPENAI_API_KEY, undefined);
  assert.ok(!JSON.stringify(c).includes("SITE_SECRET"));
  assert.ok(!JSON.stringify(c).includes("AI_SECRET"));
  assert.deepEqual(fs.readdirSync(path.join(f.dir, "codex-work")), []);
  assert.equal(f.state.codexJob.usage.outputTokens, 60);
});
test("웹 검색은 작업별로 켜고 원본 검색 쿼리·스레드 ID는 진행 기록에 남기지 않는다", async (t) => {
  const f = fixture(t);
  await f.runner.test();
  await f.runner.run({
    messages: [{ content: "SEARCH_TEST" }],
    schema: TASK_SCHEMA,
    kind: "task",
    webSearch: true,
  });
  assert.ok(f.calls.at(-1).args.includes('web_search="live"'));
  assert.ok(
    f.state.codexJob.events.some((e) => e.message === "웹 자료 확인 중"),
  );
  assert.ok(!JSON.stringify(f.state.codexJob).includes("PRIVATE_QUERY"));
  assert.ok(!JSON.stringify(f.state.codexJob).includes("private-thread"));
});
test("취소한 작업의 결과는 적용하지 않고 프로세스를 종료한다", async (t) => {
  const f = fixture(t);
  await f.runner.test();
  const pending = f.runner.run({ messages: [{ content: "HANG" }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(f.runner.stop(), true);
  await assert.rejects(pending, /중지/);
  assert.equal(f.state.codexJob.status, "stopped");
  assert.equal(f.state.codexJob.result, undefined);
  assert.equal(f.runner.isActive(), false);
});
test("동시 실행은 거부하고 시간 초과 작업은 자동 재시도하지 않는다", async (t) => {
  const f = fixture(t, { timeoutMs: 80 });
  await f.runner.test();
  const pending = f.runner.run({ messages: [{ content: "HANG" }] });
  await assert.rejects(f.runner.run({ messages: [] }), /다른 Codex/);
  await assert.rejects(pending, /시간/);
  assert.equal(f.state.codexJob.status, "failed");
  assert.equal(f.calls.filter((c) => c.args.includes("--json")).length, 1);
});
test("인증 오류와 스키마 위조 응답은 원고 반영 없이 실패하며 원본 오류 토큰을 노출하지 않는다", async (t) => {
  const f = fixture(t);
  await f.runner.test();
  await assert.rejects(
    f.runner.run({ messages: [{ content: "ERROR_AUTH" }] }),
    /인증/,
  );
  assert.ok(!JSON.stringify(f.state.codexJob).includes("PRIVATE_TOKEN"));
  await assert.rejects(
    f.runner.run({ messages: [{ content: "BAD_JSON" }] }),
    /항목/,
  );
  assert.equal(f.state.codexJob.status, "failed");
  assert.equal(f.state.codexJob.result, undefined);
});
test("예상하지 않은 명령 도구 이벤트는 중단하고 명령 원문은 기록하지 않는다", async (t) => {
  const f = fixture(t);
  await f.runner.test();
  await assert.rejects(
    f.runner.run({ messages: [{ content: "FORBIDDEN_TOOL" }] }),
    /허용하지 않은/,
  );
  assert.ok(!JSON.stringify(f.state.codexJob).includes("DO_NOT_EXPOSE"));
});
test("미연결·미설치와 Windows npm 네이티브 실행 파일 탐색을 처리한다", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.runner.run({ messages: [] }), /연결 상태/);
  assert.throws(
    () =>
      resolveExecutable("", { env: { PATH: "/missing" }, exists: () => false }),
    /찾지 못/,
  );
  const root = "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules",
    native = nativeCandidates(root, "win32", "x64")[2];
  const resolved = resolveExecutable("", {
    platform: "win32",
    arch: "x64",
    env: { Path: "C:\\Users\\user\\AppData\\Roaming\\npm" },
    exists: (p) => p === native,
    real: (p) => p,
  });
  assert.equal(resolved, native);
  assert.throws(
    () =>
      resolveExecutable("C:\\codex.cmd", {
        platform: "win32",
        exists: () => true,
        real: (p) => p,
      }),
    /실제 codex.exe/,
  );
  assert.deepEqual(
    cleanEnv({
      Path: "x",
      USERPROFILE: "home",
      OPENAI_API_KEY: "secret",
      BLOG_PASSWORD: "secret",
      CODEX_HOME: "auth",
      ELECTRON_RUN_AS_NODE: "1",
    }),
    { Path: "x", USERPROFILE: "home", CODEX_HOME: "auth" },
  );
});
