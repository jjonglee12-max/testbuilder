const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const EDITABLE = [
  "siteId",
  "title",
  "body",
  "topic",
  "type",
  "sources",
  "sourceIds",
  "images",
  "categoryIds",
  "tagIds",
  "labels",
  "disclosure",
  "generation",
  "format",
  "updateNotes",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = (v) => JSON.parse(JSON.stringify(v));
function editable(d) {
  return Object.fromEntries(
    EDITABLE.filter((k) => d[k] !== undefined).map((k) => [k, clone(d[k])]),
  );
}
function digest(v) {
  return createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v))
    .digest("hex");
}
function safeState(state) {
  const s = clone(state);
  delete s.recovery;
  delete s.backupStatus;
  s.sites = s.sites.map(({ secret, hasSecret, ...v }) => v);
  const { secret, hasSecret, testedAt, ...ai } = s.ai || {};
  s.ai = ai;
  if (s.batch) {
    s.batch.status = "interrupted";
    s.batch.stopRequested = true;
  }
  return Object.fromEntries(
    [
      "drafts",
      "sites",
      "ai",
      "prompt",
      "workspace",
      "sources",
      "media",
      "posts",
      "catalogs",
      "plans",
      "batch",
      "logs",
      "revisions",
    ]
      .filter((k) => s[k] !== undefined)
      .map((k) => [k, s[k]]),
  );
}
async function fileHash(file) {
  const h = createHash("sha256");
  for await (const b of fs.createReadStream(file)) h.update(b);
  return h.digest("hex");
}
function createStorage({
  getState,
  replaceState,
  persist,
  dir,
  siteIdentity,
  assertIdle = () => {},
}) {
  const root = path.join(dir, "backups"),
    history = path.join(dir, "history");
  let backing = false,
    restoring = false;
  function record(d, reason = "저장") {
    if (!d?.id) return;
    const snapshot = editable(d),
      hash = digest(snapshot),
      s = getState();
    s.revisions ||= [];
    const latest = s.revisions.find((r) => r.draftId === d.id);
    if (latest?.hash === hash) return;
    fs.mkdirSync(history, { recursive: true });
    const r = {
      id: randomUUID(),
      draftId: d.id,
      title: String(d.title || "제목 없음"),
      at: new Date().toISOString(),
      reason,
      hash,
      target: d.updateTarget
        ? {
            siteId: d.updateTarget.siteId,
            siteKey: d.updateTarget.siteKey,
            remoteId: d.updateTarget.remoteId,
          }
        : undefined,
    };
    fs.writeFileSync(
      path.join(history, r.id + ".json"),
      JSON.stringify(snapshot),
      { mode: 0o600 },
    );
    s.revisions.unshift(r);
    const seen = new Map();
    s.revisions = s.revisions
      .filter((r) => {
        const n = (seen.get(r.draftId) || 0) + 1;
        seen.set(r.draftId, n);
        return n <= 20;
      })
      .slice(0, 500);
  }
  function revision(id) {
    const r = getState().revisions.find((r) => r.id === id);
    if (!r || !uuid.test(id)) throw Error("원고 이력이 없습니다.");
    const raw = fs.readFileSync(path.join(history, id + ".json"), "utf8");
    if (digest(JSON.parse(raw)) !== r.hash)
      throw Error("원고 이력 파일의 내용이 손상됐습니다.");
    return { ...r, snapshot: JSON.parse(raw) };
  }
  async function snapshot(reason = "manual", parent = root) {
    if (backing) throw Error("다른 백업 작업이 진행 중입니다.");
    backing = true;
    let target;
    try {
      const s = safeState(getState()),
        id = randomUUID();
      await fsp.mkdir(parent, { recursive: true });
      target = path.join(
        parent,
        "AI-Blog-Studio-" +
          new Date().toISOString().replace(/[:.]/g, "-") +
          "-" +
          id.slice(0, 8),
      );
      await fsp.mkdir(target, { recursive: false });
      const files = [];
      const add = async (rel, source) => {
        const destination = path.join(target, rel);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.copyFile(source, destination);
        files.push({
          path: rel,
          size: (await fsp.stat(destination)).size,
          sha256: await fileHash(destination),
        });
      };
      await fsp.writeFile(path.join(target, "state.json"), JSON.stringify(s), {
        mode: 0o600,
      });
      files.push({
        path: "state.json",
        size: (await fsp.stat(path.join(target, "state.json"))).size,
        sha256: await fileHash(path.join(target, "state.json")),
      });
      for (const m of s.media || []) {
        if (!uuid.test(m.id) || !["png", "jpg", "webp"].includes(m.ext))
          throw Error("이미지 보관 정보가 올바르지 않습니다.");
        await add(
          "media/" + m.id + "." + m.ext,
          path.join(dir, "media", m.id + "." + m.ext),
        );
      }
      for (const r of s.revisions || []) {
        if (!uuid.test(r.id)) throw Error("이력 ID가 올바르지 않습니다.");
        await add(
          "history/" + r.id + ".json",
          path.join(history, r.id + ".json"),
        );
      }
      const manifest = {
        version: 1,
        id,
        reason,
        createdAt: new Date().toISOString(),
        credentialsIncluded: false,
        files,
      };
      await fsp.writeFile(
        path.join(target, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        { mode: 0o600 },
      );
      return {
        id,
        path: target,
        reason,
        createdAt: manifest.createdAt,
        files: files.length,
      };
    } catch (e) {
      if (target) await fsp.rm(target, { recursive: true, force: true });
      throw Error("백업에 실패했습니다. " + e.message);
    } finally {
      backing = false;
    }
  }
  async function list() {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const values = [];
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith("AI-Blog-Studio-")) continue;
      try {
        const m = JSON.parse(
          await fsp.readFile(path.join(root, e.name, "manifest.json"), "utf8"),
        );
        values.push({
          id: m.id,
          path: path.join(root, e.name),
          createdAt: m.createdAt,
          reason: m.reason,
          files: m.files.length,
        });
      } catch {}
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function autoBackup() {
    if (!getState().drafts.length && !getState().sites.length) return;
    const today = new Date().toISOString().slice(0, 10);
    if (
      (await list()).some(
        (v) => v.reason === "daily" && v.createdAt.startsWith(today),
      )
    )
      return;
    await snapshot("daily");
    const records = await list();
    for (const old of records.slice(10))
      await fsp.rm(old.path, { recursive: true, force: true });
  }
  async function validate(folder) {
    const base = await fsp.realpath(folder);
    const manifestFile = path.join(base, "manifest.json");
    if ((await fsp.stat(manifestFile)).size > 2e6)
      throw Error("백업 목록이 너무 큽니다.");
    const m = JSON.parse(await fsp.readFile(manifestFile, "utf8"));
    if (
      m.version !== 1 ||
      !uuid.test(m.id) ||
      !Array.isArray(m.files) ||
      m.files.length > 5000
    )
      throw Error("지원하지 않는 백업 형식입니다.");
    const seen = new Set();
    let total = 0;
    for (const f of m.files) {
      if (
        typeof f.path !== "string" ||
        (!/^state\.json$/.test(f.path) &&
          !/^media\/[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(f.path) &&
          !/^history\/[0-9a-f-]{36}\.json$/i.test(f.path)) ||
        seen.has(f.path) ||
        !/^[a-f0-9]{64}$/.test(f.sha256)
      )
        throw Error("허용되지 않는 백업 경로 또는 중복 파일입니다.");
      seen.add(f.path);
      const source = path.join(base, ...f.path.split("/")),
        real = await fsp.realpath(source);
      if (
        !real.startsWith(base + path.sep) ||
        (await fsp.lstat(source)).isSymbolicLink()
      )
        throw Error("외부 경로를 가리키는 백업은 복구할 수 없습니다.");
      const st = await fsp.stat(source);
      total += st.size;
      if (
        !st.isFile() ||
        st.size !== f.size ||
        total > 2 * 1024 ** 3 ||
        (f.path === "state.json" && st.size > 256 * 1024 ** 2)
      )
        throw Error("백업 파일 크기가 올바르지 않습니다.");
      if ((await fileHash(source)) !== f.sha256)
        throw Error("백업 파일이 손상되었거나 변경됐습니다: " + f.path);
    }
    if (!seen.has("state.json")) throw Error("백업 데이터가 없습니다.");
    const data = JSON.parse(
      await fsp.readFile(path.join(base, "state.json"), "utf8"),
    );
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw Error("백업 데이터 구조가 올바르지 않습니다.");
    for (const key of [
      "drafts",
      "sites",
      "sources",
      "media",
      "revisions",
      "posts",
      "plans",
      "logs",
    ]) {
      if (!Array.isArray(data[key] || []))
        throw Error("백업 데이터 구조가 올바르지 않습니다.");
      const ids = new Set();
      for (const row of data[key] || []) {
        if (
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          typeof row.id !== "string" ||
          !row.id ||
          ids.has(row.id)
        )
          throw Error("잘못된 레코드 또는 중복 ID입니다.");
        ids.add(row.id);
      }
    }
    const siteIds = new Set((data.sites || []).map((s) => s.id)),
      sourceIds = new Set((data.sources || []).map((s) => s.id)),
      mediaIds = new Set((data.media || []).map((s) => s.id));
    for (const s of data.sites || [])
      if (
        !["wordpress", "blogger"].includes(s.type) ||
        typeof s.name !== "string" ||
        (s.type === "wordpress"
          ? typeof s.url !== "string" || !s.url.startsWith("https://")
          : !s.blogId)
      )
        throw Error("잘못된 사이트 정보입니다.");
    for (const d of data.drafts || []) {
      if (
        typeof d.title !== "string" ||
        typeof d.body !== "string" ||
        typeof d.status !== "string" ||
        (d.siteId && !siteIds.has(d.siteId))
      )
        throw Error("잘못된 원고 정보입니다.");
      for (const key of [
        "sourceIds",
        "images",
        "categoryIds",
        "tagIds",
        "labels",
      ])
        if (d[key] !== undefined && !Array.isArray(d[key]))
          throw Error("잘못된 원고 배열입니다.");
      if (
        (d.sourceIds || []).some((id) => !sourceIds.has(id)) ||
        (d.images || []).some(
          (i) =>
            !i ||
            typeof i !== "object" ||
            (i.assetId && !mediaIds.has(i.assetId)),
        )
      )
        throw Error("원고 자료 참조가 누락됐습니다.");
    }
    if (
      data.ai &&
      (!data.ai.endpoint ||
        typeof data.ai.endpoint !== "string" ||
        typeof data.ai.model !== "string")
    )
      throw Error("잘못된 AI 설정입니다.");
    for (const record of data.media || [])
      if (
        !uuid.test(record.id) ||
        !["png", "jpg", "webp"].includes(record.ext) ||
        !seen.has("media/" + record.id + "." + record.ext)
      )
        throw Error("백업 이미지 정보가 올바르지 않습니다.");
    for (const r of data.revisions || [])
      if (!uuid.test(r.id) || !seen.has("history/" + r.id + ".json"))
        throw Error("백업 원고 이력이 누락됐습니다.");
    return { base, manifest: m, data };
  }
  async function restoreImpl(folder, { settings = false } = {}) {
    assertIdle();
    const pack = await validate(folder);
    if ((getState().restoreImports || []).includes(pack.manifest.id))
      throw Error("이미 복구한 백업입니다.");
    await snapshot("before-restore");
    assertIdle();
    const before = getState(),
      beforeHash = digest(before),
      next = clone(before),
      backup = pack.data,
      m = pack.manifest;
    next.revisions ||= [];
    next.restoreImports ||= [];
    if (next.restoreImports.includes(m.id))
      throw Error("이미 복구한 백업입니다. 중복 복구하지 않았습니다.");
    const siteMap = {},
      sourceMap = {},
      mediaMap = {},
      draftMap = {};
    const newFiles = [];
    const copy = async (rel, destination) => {
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(
        path.join(pack.base, rel),
        destination,
        fs.constants.COPYFILE_EXCL,
      );
      newFiles.push(destination);
      const expected = m.files.find((v) => v.path === rel);
      if ((await fileHash(destination)) !== expected.sha256)
        throw Error("복구 중 백업 파일이 변경됐습니다.");
    };
    try {
      for (const old of backup.sites || []) {
        const key = siteIdentity(old),
          found = next.sites.find((s) => siteIdentity(s) === key);
        if (found) siteMap[old.id] = found.id;
        else {
          const id = randomUUID();
          siteMap[old.id] = id;
          const { secret, hasSecret, ...clean } = old;
          next.sites.push({ ...clean, id });
        }
      }
      for (const old of backup.sources || []) {
        const found = next.sources.find(
          (s) => s.url === old.url && s.contentHash === old.contentHash,
        );
        if (found) sourceMap[old.id] = found.id;
        else {
          const id = randomUUID();
          sourceMap[old.id] = id;
          next.sources.push({ ...old, id });
        }
      }
      for (const old of backup.media || []) {
        const rel = "media/" + old.id + "." + old.ext,
          expected = m.files.find((v) => v.path === rel);
        let found = next.media.find(
          (v) => v.id === old.id && v.ext === old.ext,
        );
        if (found) {
          try {
            if (
              (await fileHash(
                path.join(dir, "media", found.id + "." + found.ext),
              )) !== expected.sha256
            )
              found = null;
          } catch {
            found = null;
          }
        }
        if (found) mediaMap[old.id] = found.id;
        else {
          const id = randomUUID();
          mediaMap[old.id] = id;
          await copy(rel, path.join(dir, "media", id + "." + old.ext));
          next.media.push({ ...old, id, uploads: [] });
        }
      }
      const remap = (s) => ({
        ...s,
        generation: s.generation
          ? {
              ...s.generation,
              sourceIds: (s.generation.sourceIds || []).map(
                (id) => sourceMap[id] || id,
              ),
            }
          : undefined,
        siteId: siteMap[s.siteId] || s.siteId,
        sourceIds: (s.sourceIds || []).map((id) => sourceMap[id] || id),
        images: (s.images || []).map((i) => ({
          ...i,
          assetId: i.assetId ? mediaMap[i.assetId] || i.assetId : "",
        })),
      });
      for (const old of backup.drafts || []) {
        const targetId = siteMap[old.siteId] || old.siteId;
        const sameTerminal = next.drafts.find(
          (d) =>
            ["published", "updated", "remote_scheduled", "uncertain"].includes(
              d.status,
            ) &&
            ((old.remote?.id &&
              d.remote?.id === old.remote.id &&
              d.remote.siteKey === old.remote.siteKey) ||
              (old.updateTarget?.remoteId &&
                d.updateTarget?.remoteId === old.updateTarget.remoteId &&
                d.updateTarget.siteKey === old.updateTarget.siteKey)),
        );
        if (sameTerminal) {
          draftMap[old.id] = sameTerminal.id;
          continue;
        }
        const id = randomUUID();
        draftMap[old.id] = id;
        const d = remap({
          ...old,
          id,
          siteId: targetId,
          title: ["published", "updated"].includes(old.status)
            ? old.title
            : (old.title || "제목 없음") + " (복구본)",
          status: ["published", "updated"].includes(old.status)
            ? old.status
            : [
                  "approved",
                  "queued",
                  "publishing",
                  "remote_scheduled",
                  "missed",
                  "uncertain",
                ].includes(old.status)
              ? "uncertain"
              : "draft",
          updatedAt: new Date().toISOString(),
          restoreKey: m.id + ":" + old.id,
        });
        delete d.approval;
        delete d.review;
        delete d.reviewCurrent;
        delete d.planId;
        if (d.updateTarget)
          d.updateTarget = { ...d.updateTarget, siteId: targetId };
        next.drafts.push(d);
      }
      for (const old of backup.revisions || []) {
        const raw = JSON.parse(
          await fsp.readFile(
            path.join(pack.base, "history", old.id + ".json"),
            "utf8",
          ),
        );
        if (digest(raw) !== old.hash)
          throw Error("원고 이력의 지문이 맞지 않습니다.");
        const body = remap(raw),
          id = randomUUID();
        await fsp.mkdir(history, { recursive: true });
        const destination = path.join(history, id + ".json");
        await fsp.writeFile(destination, JSON.stringify(body), {
          flag: "wx",
          mode: 0o600,
        });
        newFiles.push(destination);
        next.revisions.push({
          ...old,
          id,
          target: old.target
            ? {
                ...old.target,
                siteId: siteMap[old.target.siteId] || old.target.siteId,
              }
            : undefined,
          draftId: draftMap[old.draftId] || old.draftId,
          hash: digest(body),
        });
      }
      for (const old of backup.posts || []) {
        const siteId = siteMap[old.siteId];
        if (!siteId) continue;
        const id = siteId + ":" + old.remoteId;
        if (!next.posts.some((p) => p.id === id))
          next.posts.push({ ...old, id, siteId });
      }
      for (const old of backup.plans || []) {
        const id = randomUUID();
        next.plans.push({
          ...old,
          id,
          siteId: siteMap[old.siteId] || old.siteId,
          sourceIds: (old.sourceIds || []).map((v) => sourceMap[v] || v),
          draftId: draftMap[old.draftId],
          status: "interrupted",
          error:
            "백업에서 복구했습니다. 자료와 연결 원고를 확인한 뒤 직접 실행하세요.",
        });
      }
      if (settings) {
        next.prompt = String(backup.prompt || next.prompt);
        next.workspace = backup.workspace || next.workspace;
        if (backup.ai) {
          const secret =
            backup.ai.endpoint === before.ai.endpoint
              ? before.ai.secret
              : undefined;
          next.ai = {
            endpoint: backup.ai.endpoint,
            model: backup.ai.model,
            secret,
          };
        }
      }
      next.restoreImports.push(m.id);
      next.logs.unshift({
        id: randomUUID(),
        at: new Date().toISOString(),
        message: "백업 복구 완료 · 기존 원고 유지, 복구본 추가",
      });
      assertIdle();
      if (digest(getState()) !== beforeHash)
        throw Error("복구 중 앱 데이터가 변경됐습니다. 다시 시도하세요.");
      replaceState(next);
      return { restoredDrafts: Object.keys(draftMap).length, backupId: m.id };
    } catch (e) {
      for (const file of newFiles) await fsp.rm(file, { force: true });
      throw e;
    }
  }
  async function restore(folder, options) {
    if (restoring) throw Error("다른 복구 작업이 진행 중입니다.");
    restoring = true;
    try {
      return await restoreImpl(folder, options);
    } finally {
      restoring = false;
    }
  }
  function pruneHistory() {
    if (backing || restoring) return;
    const keep = new Set(
      (getState().revisions || []).map((r) => r.id + ".json"),
    );
    if (!fs.existsSync(history)) return;
    for (const name of fs.readdirSync(history))
      if (
        uuid.test(name.replace(/\.json$/, "")) &&
        name.endsWith(".json") &&
        !keep.has(name)
      )
        try {
          fs.unlinkSync(path.join(history, name));
        } catch {}
  }
  return {
    pruneHistory,
    record,
    revision,
    snapshot,
    list,
    autoBackup,
    validate,
    restore,
    backing: () => backing,
  };
}
module.exports = { createStorage, editable, digest, safeState };
