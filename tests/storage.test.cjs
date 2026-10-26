const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createStorage, digest } = require("../electron/storage.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-backup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let state = {
    sites: [
      {
        id: "site",
        name: "블로그",
        type: "wordpress",
        url: "https://example.com",
        secret: "SITE_SECRET",
      },
    ],
    ai: {
      endpoint: "https://api.example.com/v1",
      model: "test",
      secret: "AI_SECRET",
    },
    drafts: [],
    sources: [],
    media: [],
    posts: [],
    plans: [],
    logs: [],
    revisions: [],
    workspace: { name: "개인" },
    prompt: "기준",
  };
  const storage = createStorage({
    dir,
    getState: () => state,
    replaceState: (s) => {
      state = s;
    },
    persist() {},
    siteIdentity: (s) => s.type + ":" + s.url,
  });
  return {
    dir,
    storage,
    get state() {
      return state;
    },
  };
}
test("백업은 인증정보를 제외하고 원고·이미지·이력 무결성을 보존한다", async (t) => {
  const f = fixture(t),
    id = randomUUID();
  fs.mkdirSync(path.join(f.dir, "media"));
  fs.writeFileSync(path.join(f.dir, "media", id + ".png"), "image");
  f.state.media.push({ id, ext: "png" });
  const d = {
    id: "draft",
    siteId: "site",
    title: "원고",
    body: "본문",
    status: "approved",
    images: [{ assetId: id }],
    approval: { hash: "old" },
  };
  f.state.drafts.push(d);
  f.storage.record(d);
  const b = await f.storage.snapshot();
  const p = await f.storage.validate(b.path);
  const raw = JSON.stringify(p.data);
  assert.ok(!raw.includes("SITE_SECRET"));
  assert.ok(!raw.includes("AI_SECRET"));
  assert.equal(p.manifest.files.length, 3);
  assert.equal(
    f.storage.revision(f.state.revisions[0].id).snapshot.body,
    "본문",
  );
});
test("백업 손상과 경로 탈출은 복구 전에 거부한다", async (t) => {
  const f = fixture(t),
    b = await f.storage.snapshot();
  fs.appendFileSync(path.join(b.path, "state.json"), "x");
  await assert.rejects(f.storage.validate(b.path), /크기|손상/);
  const b2 = await f.storage.snapshot(),
    m = JSON.parse(fs.readFileSync(path.join(b2.path, "manifest.json")));
  m.files.push({ path: "../studio.json", size: 0, sha256: "0".repeat(64) });
  fs.writeFileSync(path.join(b2.path, "manifest.json"), JSON.stringify(m));
  await assert.rejects(f.storage.validate(b2.path), /경로/);
});
test("복구는 현재 원고·인증을 유지하고 예약/승인은 재개하지 않는다", async (t) => {
  const f = fixture(t);
  f.state.drafts.push({
    id: "draft",
    siteId: "site",
    title: "백업",
    body: "옛글",
    status: "queued",
    approval: { hash: "x" },
    publication: { mode: "local", at: "2027-01-01" },
  });
  f.storage.record(f.state.drafts[0]);
  const b = await f.storage.snapshot();
  f.state.drafts[0].body = "현재 편집";
  f.state.sites[0].secret = "CURRENT";
  await f.storage.restore(b.path);
  assert.equal(f.state.drafts[0].body, "현재 편집");
  const copy = f.state.drafts[1];
  assert.equal(copy.status, "uncertain");
  assert.equal(copy.approval, undefined);
  assert.equal(f.state.sites[0].secret, "CURRENT");
  assert.equal(f.state.revisions.length, 2);
  assert.ok(
    (await f.storage.list()).some((b) => b.reason === "before-restore"),
  );
  await assert.rejects(f.storage.restore(b.path), /이미 복구/);
});
test("복구 동시 요청을 차단하고 완료 후 다시 사용할 수 있다", async (t) => {
  const f = fixture(t),
    b = await f.storage.snapshot();
  const first = f.storage.restore(b.path);
  await assert.rejects(f.storage.restore(b.path), /진행 중/);
  await first;
  await assert.rejects(f.storage.restore(b.path), /이미 복구/);
});
test("구조가 잘못된 백업은 체크섬이 맞더라도 거부한다", async (t) => {
  const f = fixture(t),
    b = await f.storage.snapshot();
  const file = path.join(b.path, "state.json"),
    data = JSON.parse(fs.readFileSync(file));
  data.drafts = [{ id: "x", body: 3 }];
  fs.writeFileSync(file, JSON.stringify(data));
  const mf = path.join(b.path, "manifest.json"),
    m = JSON.parse(fs.readFileSync(mf));
  m.files[0].size = fs.statSync(file).size;
  m.files[0].sha256 = digest(fs.readFileSync(file));
  fs.writeFileSync(mf, JSON.stringify(m));
  await assert.rejects(f.storage.restore(b.path), /원고 정보/);
});
test("원고 이력은 최근 20개를 유지하며 보관 파일을 정리한다", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++)
    f.storage.record({ id: "d", title: "제목", body: String(i) });
  assert.equal(f.state.revisions.length, 20);
  f.storage.pruneHistory();
  assert.equal(fs.readdirSync(path.join(f.dir, "history")).length, 20);
  const r = f.state.revisions[0];
  fs.writeFileSync(path.join(f.dir, "history", r.id + ".json"), "{}");
  assert.throws(() => f.storage.revision(r.id), /손상/);
});
test("같은 원격 게시 이력은 복구 과정에서 중복 추가하지 않는다", async (t) => {
  const f = fixture(t);
  f.state.drafts.push({
    id: "d",
    title: "게시됨",
    body: "내용",
    status: "published",
    siteId: "site",
    remote: { id: "44", siteKey: "same" },
  });
  const b = await f.storage.snapshot();
  await f.storage.restore(b.path);
  assert.equal(f.state.drafts.length, 1);
});
