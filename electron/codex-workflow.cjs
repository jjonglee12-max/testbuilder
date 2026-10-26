const { createHash } = require("node:crypto");
const { TASK_SCHEMA, running } = require("./codex.cjs");
const { profile, evidence } = require("./editorial.cjs");
const { httpsUrl } = require("./core.cjs");
function installCodex({
  ipcMain,
  dialog,
  shell,
  getState,
  persist,
  publicState,
  codex,
  saveDraft,
  assertBatchIdle,
}) {
  const S = getState;
  const idle = () => {
    assertBatchIdle();
    if (codex.isBusy())
      throw Error("Codex 작업 또는 연결 확인을 마친 뒤 설정을 변경하세요.");
  };
  ipcMain.handle("saveCodex", (_, input) => {
    idle();
    const executable = String(input.executable || "").trim(),
      model = String(input.model || "").trim();
    if (
      model.length > 100 ||
      (model && !/^[a-zA-Z0-9._:-]+$/.test(model)) ||
      executable.length > 2000 ||
      /[\r\n\0]/.test(executable)
    )
      throw Error("실행 경로 또는 모델 ID가 올바르지 않습니다.");
    const previous = S().codex || {};
    S().codex = {
      executable,
      model,
      webSearch: !!input.webSearch,
      connection:
        executable === previous.executable ? previous.connection : undefined,
    };
    persist();
    return publicState();
  });
  ipcMain.handle("chooseCodex", async () => {
    idle();
    const pick = await dialog.showOpenDialog({
      title: "Codex CLI 실제 실행 파일 선택",
      properties: ["openFile"],
      ...(process.platform === "win32"
        ? { filters: [{ name: "Codex 실행 파일", extensions: ["exe"] }] }
        : {}),
    });
    if (pick.canceled) return { cancelled: true };
    return { path: pick.filePaths[0] };
  });
  ipcMain.handle("testCodex", async () => {
    assertBatchIdle();
    return codex.test();
  });
  ipcMain.handle("codexDocs", () =>
    shell.openExternal("https://developers.openai.com/codex/cli/"),
  );
  ipcMain.handle("setAIEngine", (_, engine) => {
    idle();
    if (!["api", "codex"].includes(engine))
      throw Error("지원하지 않는 작업 엔진입니다.");
    if (engine === "codex" && !S().codex?.connection?.loggedIn)
      throw Error("Codex 연결 확인과 로그인을 먼저 완료하세요.");
    S().aiEngine = engine;
    persist();
    return publicState();
  });
  ipcMain.handle("stopCodex", () => {
    codex.stop();
    return publicState();
  });
  ipcMain.handle("startCodexTask", async (_, input) => {
    idle();
    const request = String(input.request || "").trim();
    if (!request || request.length > 12000)
      throw Error("작업 요청은 1~12,000자로 입력하세요.");
    const site = S().sites.find((s) => s.id === input.siteId);
    if (!site) throw Error("글쓰기 기준 사이트를 선택하세요.");
    const ids = Array.isArray(input.sourceIds)
      ? [...new Set(input.sourceIds)]
      : [];
    if (
      ids.length > 8 ||
      ids.some((id) => !S().sources.some((s) => s.id === id))
    )
      throw Error("보관 자료는 최대 8개 선택하세요.");
    const original = input.draftId
      ? S().drafts.find((d) => d.id === input.draftId)
      : null;
    if (input.draftId && (!original || original.siteId !== site.id))
      throw Error("선택한 사이트의 참고 원고를 선택하세요.");
    if (original?.format === "html")
      throw Error("기존 게시글 HTML 수정은 편집기의 수정 도우미를 사용하세요.");
    const webSearch = !!input.webSearch && !!S().codex?.webSearch;
    const messages = [
      {
        role: "system",
        content:
          S().prompt +
          "\n자연어 요청에 따라 주제 제안·자료 조사·초안 작성·기존 초안 개선을 돕는다. 글이 필요 없으면 draft=null로 반환하고 topics에 제안한다. 기존 원고는 참고본이며 덮어쓰지 않는다. 본문은 앱이 지원하는 ## 제목, 문단, HTTPS 링크로 작성한다. 주제는 최대 10개. 모든 웹 URL은 참고 후보이며 앱의 보관 자료로 자동 검증된 것이 아니다. 가격·버전·날짜의 적용 조건과 불확실성을 남긴다. 승인·발행·예약을 수행하지 않는다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          request,
          date: new Date().toLocaleDateString("sv-SE", {
            timeZone: "Asia/Seoul",
          }),
          profile: profile(site.profile),
          evidence: evidence({ sourceIds: ids }, S().sources),
          referenceDraft: original
            ? {
                title: original.title,
                body: original.body,
                notes: original.sources,
              }
            : null,
        }),
      },
    ];
    const context = {
      siteId: site.id,
      sourceIds: ids,
      request,
      profile: profile(site.profile),
      promptHash: createHash("sha256").update(S().prompt).digest("hex"),
    };
    const previous = S().codexJob;
    const promise = codex.run({
      messages,
      schema: TASK_SCHEMA,
      kind: "task",
      webSearch,
    });
    if (S().codexJob?.status === "running") {
      S().codexJob.context = context;
      persist();
    }
    promise.catch(() => {});
    if (S().codexJob === previous) await promise;
    return publicState();
  });
  ipcMain.handle("importCodexDraft", (_, id) => {
    idle();
    const job = S().codexJob;
    if (
      job?.id !== id ||
      job.status !== "completed" ||
      job.kind !== "task" ||
      !job.result?.draft
    )
      throw Error("가져올 Codex 초안이 없습니다.");
    if (job.importedDraftId) {
      const existing = S().drafts.find((d) => d.id === job.importedDraftId);
      if (!existing)
        throw Error("가져온 원고가 삭제됐습니다. 새 작업으로 다시 준비하세요.");
      return { state: publicState(), draftId: existing.id };
    }
    const context = job.context;
    if (!S().sites.some((s) => s.id === context.siteId))
      throw Error("작업에 사용한 사이트가 삭제됐습니다.");
    const d = job.result.draft,
      urls = [...new Set(job.result.sourceUrls || [])]
        .slice(0, 30)
        .filter((url) => {
          try {
            httpsUrl(url);
            return true;
          } catch {
            return false;
          }
        });
    const saved = saveDraft({
      title: d.title,
      body: d.body,
      topic: d.title,
      type: "개념·업무 활용",
      siteId: context.siteId,
      sourceIds: context.sourceIds,
      images: [],
      sources: [
        d.notes,
        job.result.summary,
        ...job.result.warnings,
        urls.length
          ? "Codex가 제시한 참고 URL (보관 자료로 수집·확인 필요):\n" +
            urls.join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      publication: { mode: "now" },
      generation: {
        model: "codex/" + job.model,
        at: job.completedAt,
        promptHash: context.promptHash,
        profile: context.profile,
        sourceIds: context.sourceIds,
      },
    });
    job.importedDraftId = saved.id;
    persist();
    return { state: publicState(), draftId: saved.id };
  });
}
module.exports = { installCodex };
