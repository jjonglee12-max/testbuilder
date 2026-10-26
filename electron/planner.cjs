const { randomUUID, createHash } = require("node:crypto");
const { httpsUrl } = require("./core.cjs");
const C = require("./catalog.cjs");
const active = (s) => ["running", "stopping"].includes(s.batch?.status);
function signature(p) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        siteId: p.siteId,
        topic: p.topic,
        type: p.type,
        notes: p.notes,
        sourceIds: p.sourceIds,
        urls: p.urls,
        categoryIds: p.categoryIds,
        tagIds: p.tagIds,
        labels: p.labels,
      }),
    )
    .digest("hex");
}
function installPlanner({
  ipcMain,
  getState,
  persist,
  publicState,
  request,
  headers,
  siteIdentity,
  saveDraft,
  generate,
  review,
  collect,
  log,
  defer = (fn) => Promise.resolve().then(fn),
}) {
  const S = getState;
  const findSite = (id) => {
    const site = S().sites.find((v) => v.id === id);
    if (!site) throw Error("사이트를 선택하세요.");
    return site;
  };
  const writable = (p) => {
    if (["queued", "running"].includes(p.status))
      throw Error("준비 중인 기획은 중지 후 수정하세요.");
  };
  const freshPosts = (id) => {
    const site = findSite(id);
    return S().posts.filter(
      (p) => p.siteId === id && p.siteKey === siteIdentity(site),
    );
  };
  function warnings(p) {
    const result = C.duplicates(
      p.topic,
      p.siteId,
      freshPosts(p.siteId),
      S().drafts,
      p.draftId,
    );
    for (const other of S().plans) {
      if (other.id === p.id || other.siteId !== p.siteId) continue;
      if (
        C.titleKey(other.topic) === C.titleKey(p.topic) ||
        C.similarity(other.topic, p.topic) >= 0.72
      )
        result.push({
          id: "plan:" + other.id,
          title: other.topic + " (등록 기획)",
          url: "",
          exact: C.titleKey(other.topic) === C.titleKey(p.topic),
        });
    }
    return result.slice(0, 8);
  }
  let syncBusy = new Set();
  ipcMain.handle("syncTaxonomy", async (_, id) => {
    if (active(S()))
      throw Error("일괄 준비를 중지한 뒤 분류를 새로고침하세요.");
    const site = { ...findSite(id) },
      key = siteIdentity(site);
    if (syncBusy.has(id)) throw Error("이 사이트를 이미 불러오는 중입니다.");
    syncBusy.add(id);
    try {
      const firstPage =
        site.type === "blogger" && !freshPosts(id).length
          ? await C.postsPage(
              site,
              S().catalogs[id],
              request,
              headers(site),
              key,
              true,
            )
          : null;
      const postSnapshot = firstPage
        ? [...S().posts.filter((p) => p.siteId !== id), ...firstPage.posts]
        : S().posts;
      const result = await C.syncTaxonomy(
        site,
        request,
        headers(site),
        key,
        postSnapshot,
      );
      if (siteIdentity(findSite(id)) !== key)
        throw Error("불러오는 중 사이트 연결이 변경됐습니다. 다시 실행하세요.");
      if (firstPage) S().posts = postSnapshot;
      S().catalogs[id] = {
        ...(S().catalogs[id]?.siteKey === key ? S().catalogs[id] : {}),
        ...(firstPage ? firstPage.cursor : {}),
        ...result,
      };
      persist();
      return publicState();
    } finally {
      syncBusy.delete(id);
    }
  });
  ipcMain.handle("syncPosts", async (_, input) => {
    if (active(S()))
      throw Error("일괄 준비를 중지한 뒤 기존 글을 새로고침하세요.");
    const site = { ...findSite(input.siteId) },
      key = siteIdentity(site);
    if (syncBusy.has(site.id))
      throw Error("이 사이트를 이미 불러오는 중입니다.");
    if (
      !input.reset &&
      S().catalogs[site.id]?.siteKey === key &&
      S().catalogs[site.id]?.postsComplete
    )
      return { state: publicState(), count: 0, skipped: [] };
    syncBusy.add(site.id);
    try {
      const result = await C.postsPage(
        site,
        S().catalogs[site.id],
        request,
        headers(site),
        key,
        !!input.reset,
      );
      if (siteIdentity(findSite(site.id)) !== key)
        throw Error("불러오는 중 사이트 연결이 변경됐습니다. 다시 실행하세요.");
      const existing = input.reset
        ? S().posts.filter((p) => p.siteId !== site.id)
        : S().posts;
      const map = new Map(existing.map((p) => [p.id, p]));
      for (const p of result.posts) map.set(p.id, p);
      S().posts = [...map.values()];
      const previous =
        S().catalogs[site.id]?.siteKey === key ? S().catalogs[site.id] : {};
      S().catalogs[site.id] = {
        ...previous,
        ...result.cursor,
        labels: [
          ...new Set(
            S()
              .posts.filter((p) => p.siteId === site.id && p.siteKey === key)
              .flatMap((p) => p.labels || []),
          ),
        ].sort(),
      };
      log(`${site.name}: 기존 글 ${result.posts.length}건 불러오기`);
      persist();
      return {
        state: publicState(),
        count: result.posts.length,
        skipped: result.skipped,
      };
    } finally {
      syncBusy.delete(site.id);
    }
  });
  ipcMain.handle("recommendLinks", (_, d) => ({
    links: C.links(d, freshPosts(d.siteId)),
    duplicates: C.duplicates(
      d.title || d.topic,
      d.siteId,
      freshPosts(d.siteId),
      S().drafts,
      d.id,
    ),
  }));
  ipcMain.handle("savePlan", (_, input) => {
    const old = S().plans.find((p) => p.id === input.id);
    if (old) writable(old);
    const site = findSite(input.siteId);
    const topic = String(input.topic || "")
      .trim()
      .slice(0, 300);
    if (!topic) throw Error("주제를 입력하세요.");
    const urls = [
      ...new Set(
        (Array.isArray(input.urls)
          ? input.urls
          : String(input.urls || "").split(/\s+/)
        )
          .map((v) => String(v).trim())
          .filter(Boolean),
      ),
    ];
    if (urls.length > 5) throw Error("기획별 URL은 최대 5개입니다.");
    urls.forEach(httpsUrl);
    const sourceIds = [
      ...new Set(Array.isArray(input.sourceIds) ? input.sourceIds : []),
    ];
    if (
      sourceIds.length > 8 ||
      sourceIds.some((id) => !S().sources.some((s) => s.id === id))
    )
      throw Error("올바른 자료를 최대 8개 선택하세요.");
    if (input.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate))
      throw Error("작성 예정일 형식을 확인하세요.");
    const p = {
      ...old,
      id: old?.id || randomUUID(),
      siteId: site.id,
      siteKey: siteIdentity(site),
      topic,
      type: String(input.type || "도구 소개"),
      notes: String(input.notes || "").slice(0, 20000),
      urls,
      sourceIds,
      ...C.taxonomy(input, site, S().catalogs[site.id], siteIdentity(site)),
      targetDate: input.targetDate || "",
      allowDuplicate: !!input.allowDuplicate,
      status: old?.status || "idea",
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (old && (signature(old) !== signature(p) || old.siteKey !== p.siteKey)) {
      p.previousDraftIds = [
        ...(old.previousDraftIds || []),
        ...(old.draftId ? [old.draftId] : []),
      ].slice(-10);
      delete p.draftId;
      delete p.preparedHash;
      delete p.error;
      delete p.stage;
      p.status = "idea";
    }
    p.duplicates = warnings(p);
    S().plans = [p, ...S().plans.filter((v) => v.id !== p.id)];
    persist();
    return publicState();
  });
  ipcMain.handle("deletePlan", (_, id) => {
    const p = S().plans.find((p) => p.id === id);
    if (!p) throw Error("기획이 없습니다.");
    writable(p);
    S().plans = S().plans.filter((p) => p.id !== id);
    persist();
    return publicState();
  });
  function stopped(batch) {
    return batch.stopRequested || S().batch?.id !== batch.id;
  }
  function finishQueued(batch) {
    for (const p of S().plans)
      if (batch.planIds.includes(p.id) && p.status === "queued") {
        p.status = p.beforeQueueStatus || "idea";
        delete p.beforeQueueStatus;
      }
  }
  async function prepare(p, batch) {
    const site = findSite(p.siteId);
    if (siteIdentity(site) !== p.siteKey)
      throw Error(
        "기획 당시 사이트 연결이 변경됐습니다. 기획을 다시 저장하세요.",
      );
    C.taxonomy(p, site, S().catalogs[site.id], siteIdentity(site));
    let d = p.draftId ? S().drafts.find((d) => d.id === p.draftId) : null;
    const hash = signature(p);
    if (d && d.status !== "draft")
      throw Error(
        "이미 승인·예약·발행된 연결 원고는 다시 준비할 수 없습니다. 새 기획을 만드세요.",
      );
    if (!(d && p.preparedHash === hash && d.body?.trim())) {
      p.stage = "collect";
      persist();
      if (!p.urls.length && !p.notes.trim() && !p.sourceIds.length)
        throw Error("참고 URL·자료 또는 메모를 먼저 등록하세요.");
      let collected = [];
      if (p.urls.length) {
        const result = await collect({ urls: p.urls.join("\n") });
        collected = result.ids;
        p.collectedSourceIds = collected;
        if (result.errors.length)
          throw Error(
            result.errors.map((v) => v.url + ": " + v.message).join(" / "),
          );
      }
      const sourceIds = [...new Set([...p.sourceIds, ...collected])];
      if (sourceIds.length > 8)
        throw Error("연결 자료가 8개를 넘습니다. 자료 선택을 줄이세요.");
      if (stopped(batch)) {
        p.status = "interrupted";
        p.error = "자료 수집 후 중지했습니다.";
        persist();
        return;
      }
      p.stage = "write";
      persist();
      const input = {
        topic: p.topic,
        type: p.type,
        siteId: p.siteId,
        sources: p.notes,
        sourceIds,
        images: [],
        publication: { mode: "now" },
        categoryIds: p.categoryIds,
        tagIds: p.tagIds,
        labels: p.labels,
      };
      const result = await generate(input);
      d = saveDraft(
        {
          ...input,
          title: result.title,
          body: result.body,
          generation: result.generation,
          reviewNotes: result.notes || "",
          planId: p.id,
        },
        { batch: true },
      );
      p.draftId = d.id;
      p.preparedHash = hash;
      p.stage = "review";
      persist();
    }
    if (stopped(batch)) {
      p.status = "interrupted";
      p.error = "초안은 저장했으며 검토 전에 중지했습니다.";
      persist();
      return;
    }
    p.stage = "review";
    persist();
    await review(d.id, { batch: true });
    const current = S().drafts.find((v) => v.id === d.id);
    p.status =
      current.review?.verdict === "ready_for_human" ? "ready" : "review_needed";
    p.stage = "done";
    p.error = "";
    p.duplicates = C.duplicates(
      current.title,
      p.siteId,
      freshPosts(p.siteId),
      S().drafts,
      d.id,
    );
    if (p.duplicates.length) {
      p.status = "review_needed";
      p.error = "기존 글과 비슷한 제목이 있습니다. 원고를 직접 비교하세요.";
    }
    p.finishedAt = new Date().toISOString();
    delete p.beforeQueueStatus;
    persist();
  }
  async function work(id) {
    const batch = S().batch;
    if (batch?.id !== id) return;
    for (const planId of batch.planIds) {
      if (stopped(batch)) break;
      const p = S().plans.find((v) => v.id === planId);
      if (!p || p.status !== "queued") continue;
      p.status = "running";
      batch.currentId = p.id;
      delete p.error;
      persist();
      try {
        await prepare(p, batch);
      } catch (e) {
        p.status = "failed";
        p.error = e.message || "준비 실패";
        log(`${p.topic}: 일괄 준비 실패 · ${p.error}`);
        if (["write", "review"].includes(p.stage)) {
          batch.stopRequested = true;
          batch.error =
            "AI 단계에 오류가 발생해 후속 작업을 중지했습니다. " + p.error;
        }
        persist();
      }
      batch.done = batch.planIds.filter((id) =>
        ["ready", "review_needed", "failed"].includes(
          S().plans.find((p) => p.id === id)?.status,
        ),
      ).length;
      persist();
    }
    finishQueued(batch);
    batch.status = batch.stopRequested ? "stopped" : "completed";
    batch.currentId = null;
    batch.finishedAt = new Date().toISOString();
    log(
      `일괄 준비 ${batch.status === "completed" ? "완료" : "중지"} · ${batch.done}/${batch.total}`,
    );
    persist();
  }
  ipcMain.handle("startBatch", (_, input) => {
    if (active(S())) throw Error("다른 일괄 준비가 실행 중입니다.");
    if (syncBusy.size) throw Error("사이트 불러오기가 끝난 뒤 시작하세요.");
    const ids = [...new Set(Array.isArray(input.planIds) ? input.planIds : [])];
    if (!ids.length || ids.length > 20)
      throw Error("한 번에 기획을 1~20개 선택하세요.");
    for (const id of ids) {
      const p = S().plans.find((v) => v.id === id);
      if (!p) throw Error("선택한 기획이 없습니다.");
      writable(p);
      findSite(p.siteId);
      const d = S().drafts.find((d) => d.id === p.draftId);
      if (d && d.status !== "draft")
        throw Error(
          "승인·예약·발행된 연결 원고가 있습니다. 새 기획을 만드세요.",
        );
      p.duplicates = warnings(p);
      if (p.duplicates.length && !p.allowDuplicate)
        throw Error(
          "유사한 글이 있는 기획은 중복 경고를 확인하고 허용 여부를 선택하세요.",
        );
    }
    if (!S().ai.hasSecret && !S().ai.secret)
      throw Error("AI API를 먼저 연결하세요.");
    const batch = {
      id: randomUUID(),
      status: "running",
      planIds: ids,
      total: ids.length,
      done: 0,
      startedAt: new Date().toISOString(),
      stopRequested: false,
    };
    for (const id of ids) {
      const p = S().plans.find((p) => p.id === id);
      p.beforeQueueStatus = p.status;
      p.status = "queued";
    }
    S().batch = batch;
    persist();
    defer(() =>
      work(batch.id).catch((e) => {
        batch.status = "stopped";
        batch.error = e.message;
        finishQueued(batch);
        for (const p of S().plans)
          if (batch.planIds.includes(p.id) && p.status === "running") {
            p.status = "interrupted";
            p.error = e.message;
          }
        persist();
      }),
    );
    return publicState();
  });
  ipcMain.handle("stopBatch", () => {
    if (active(S())) {
      S().batch.stopRequested = true;
      S().batch.status = "stopping";
      persist();
    }
    return publicState();
  });
  return { work };
}
module.exports = { installPlanner, signature };
