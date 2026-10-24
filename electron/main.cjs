const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const {
  html,
  fingerprint,
  issues,
  assertApproved,
  httpsUrl,
} = require("./core.cjs");
let state, file;
function persist() {
  fs.writeFileSync(file + ".tmp", JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(file + ".tmp", file);
}
function publicState() {
  return {
    ...state,
    sites: state.sites.map(({ secret, ...s }) => ({
      ...s,
      hasSecret: !!secret,
    })),
    ai: { ...state.ai, secret: undefined, hasSecret: !!state.ai.secret },
  };
}
function encrypt(v) {
  if (
    !safeStorage.isEncryptionAvailable() ||
    safeStorage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw Error(
      "운영체제 보안 저장소를 사용할 수 없습니다. 인증정보를 저장하지 않았습니다.",
    );
  return safeStorage.encryptString(v).toString("base64");
}
function decrypt(v) {
  if (!v) throw Error("인증정보를 먼저 저장하세요.");
  return safeStorage.decryptString(Buffer.from(v, "base64"));
}
const find = (id) => {
  const d = state.drafts.find((d) => d.id === id);
  if (!d) throw Error("원고를 찾을 수 없습니다.");
  return d;
};
function log(message) {
  state.logs.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    message,
  });
  state.logs = state.logs.slice(0, 200);
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok)
    throw Error(
      `연결 실패 (HTTP ${r.status}). 주소·권한·인증정보를 확인하세요.`,
    );
  return r.json();
}
function siteRequest(s, publish = false, d) {
  if (s.type === "wordpress") {
    const base = httpsUrl(s.url).href.replace(/\/$/, "");
    return [
      base + (publish ? "/wp-json/wp/v2/posts" : "/wp-json/wp/v2/users/me"),
      {
        method: publish ? "POST" : "GET",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(s.username + ":" + decrypt(s.secret)).toString(
              "base64",
            ),
          "Content-Type": "application/json",
        },
        ...(publish
          ? {
              body: JSON.stringify({
                title: d.title,
                content: html(d.body),
                status: "publish",
              }),
            }
          : {}),
      },
    ];
  }
  if (!/^\d+$/.test(s.blogId))
    throw Error("Blogger 블로그 ID는 숫자여야 합니다.");
  return [
    `https://www.googleapis.com/blogger/v3/blogs/${s.blogId}${publish ? "/posts" : ""}`,
    {
      method: publish ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + decrypt(s.secret),
        "Content-Type": "application/json",
      },
      ...(publish
        ? {
            body: JSON.stringify({
              kind: "blogger#post",
              title: d.title,
              content: html(d.body),
            }),
          }
        : {}),
    },
  ];
}
app.whenReady().then(() => {
  file = path.join(app.getPath("userData"), "studio.json");
  state = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {
        drafts: [],
        sites: [],
        logs: [],
        ai: { endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
        prompt: fs.readFileSync(
          path.join(__dirname, "../prompts/ai-blog-v1.md"),
          "utf8",
        ),
      };
  for (const d of state.drafts)
    if (d.status === "publishing") d.status = "uncertain";
  persist();
  ipcMain.handle("load", () => publicState());
  ipcMain.handle("saveDraft", (_, input) => {
    const old = state.drafts.find((d) => d.id === input.id);
    if (old && ["publishing", "published", "uncertain"].includes(old.status))
      throw Error("발행 내역은 수정할 수 없습니다. 새 원고로 복사하세요.");
    const d = {
      id: old?.id || randomUUID(),
      title: String(input.title || ""),
      body: String(input.body || ""),
      topic: String(input.topic || ""),
      type: String(input.type || "도구 소개"),
      sources: String(input.sources || ""),
      siteId: String(input.siteId || ""),
      disclosure: String(input.disclosure || ""),
      reviewNotes: String(input.reviewNotes || ""),
      generation: input.generation
        ? {
            model: String(input.generation.model || ""),
            promptHash: String(input.generation.promptHash || ""),
            at: String(input.generation.at || ""),
          }
        : undefined,
      updatedAt: new Date().toISOString(),
      status: "draft",
    };
    if (
      old?.approval &&
      old.approval.hash ===
        fingerprint(
          d,
          state.sites.find((s) => s.id === d.siteId),
        )
    ) {
      d.approval = old.approval;
      d.status = "approved";
    }
    state.drafts = state.drafts.filter((x) => x.id !== d.id);
    state.drafts.unshift(d);
    persist();
    return d;
  });
  ipcMain.handle("deleteDraft", (_, id) => {
    const d = find(id);
    if (["publishing", "uncertain", "published"].includes(d.status))
      throw Error("발행 기록은 보존됩니다.");
    state.drafts = state.drafts.filter((x) => x.id !== id);
    persist();
    return publicState();
  });
  ipcMain.handle("saveSite", (_, s) => {
    if (!["wordpress", "blogger"].includes(s.type))
      throw Error("지원하지 않는 플랫폼입니다.");
    if (!String(s.name || "").trim()) throw Error("사이트 이름을 입력하세요.");
    if (s.type === "wordpress") {
      httpsUrl(s.url);
      if (!s.username?.trim()) throw Error("WordPress 사용자명을 입력하세요.");
    } else if (!/^\d+$/.test(s.blogId || ""))
      throw Error("숫자 블로그 ID를 입력하세요.");
    const old = state.sites.find((x) => x.id === s.id);
    const item = {
      id: old?.id || randomUUID(),
      name: s.name,
      type: s.type,
      url: s.url || "",
      username: s.username || "",
      blogId: s.blogId || "",
      secret: s.credential ? encrypt(s.credential) : old?.secret,
    };
    state.sites = state.sites.filter((x) => x.id !== item.id);
    state.sites.push(item);
    persist();
    return publicState();
  });
  ipcMain.handle("testSite", async (_, id) => {
    const s = state.sites.find((x) => x.id === id);
    if (!s) throw Error("사이트를 찾을 수 없습니다.");
    await request(...siteRequest(s));
    log(`${s.name}: 읽기 연결 확인 완료 (게시 권한은 실제 발행 시 확인)`);
    persist();
    return publicState();
  });
  ipcMain.handle("saveAI", (_, a) => {
    httpsUrl(a.endpoint);
    state.ai = {
      endpoint: a.endpoint.replace(/\/$/, ""),
      model: a.model,
      secret: a.credential ? encrypt(a.credential) : state.ai.secret,
    };
    persist();
    return publicState();
  });
  ipcMain.handle("savePrompt", (_, p) => {
    if (!String(p).trim()) throw Error("프롬프트를 입력하세요.");
    state.prompt = String(p);
    persist();
    return publicState();
  });
  ipcMain.handle("generate", async (_, input) => {
    const a = state.ai;
    httpsUrl(a.endpoint);
    const result = await request(a.endpoint + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + decrypt(a.secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: a.model,
        messages: [
          {
            role: "system",
            content:
              state.prompt +
              '\n현재 호출에서는 웹 검색이나 직접 테스트를 할 수 없다. 제공된 자료 안에서만 작성하고 검증하지 않은 수치를 만들지 마라. 출력은 JSON 객체만: {"title":"제목","body":"마크다운 원고","notes":"검토할 사항"}. 발행하거나 사용자 승인을 생성하지 마라.',
          },
          {
            role: "user",
            content: JSON.stringify({
              topic: input.topic,
              type: input.type,
              sourceMaterial: input.sources,
              date: new Date().toLocaleDateString("sv-SE", {
                timeZone: "Asia/Seoul",
              }),
            }),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const raw = result.choices?.[0]?.message?.content;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error(
        "AI 응답 형식이 올바르지 않습니다. 원고를 변경하지 않았습니다.",
      );
    }
    if (typeof value.title !== "string" || typeof value.body !== "string")
      throw Error("AI 응답에 제목 또는 본문이 없습니다.");
    log("AI 초안 생성 완료 · 외부 출처 검증은 미실행");
    persist();
    return {
      ...value,
      generation: {
        model: a.model,
        promptHash: createHash("sha256").update(state.prompt).digest("hex"),
        at: new Date().toISOString(),
      },
    };
  });
  ipcMain.handle("approve", (_, id) => {
    const d = find(id);
    if (["publishing", "published", "uncertain"].includes(d.status))
      throw Error("현재 상태에서는 승인할 수 없습니다.");
    const e = issues(d);
    if (e.length) throw Error(e.join(" "));
    const s = state.sites.find((x) => x.id === d.siteId);
    if (!s) throw Error("사이트가 없습니다.");
    d.approval = { at: new Date().toISOString(), hash: fingerprint(d, s) };
    d.status = "approved";
    persist();
    return publicState();
  });
  ipcMain.handle("publish", async (_, id) => {
    const d = find(id),
      s = state.sites.find((x) => x.id === d.siteId);
    assertApproved(d, s);
    const args = siteRequest(s, true, d);
    d.status = "publishing";
    persist();
    try {
      const r = await request(...args);
      const url = r.link || r.url;
      if (!url) throw Error("발행 주소를 확인하지 못했습니다.");
      d.status = "published";
      d.publishedUrl = url;
      d.publishedAt = new Date().toISOString();
      log(`${d.title}: 발행 완료`);
      persist();
      return publicState();
    } catch (e) {
      d.status = "uncertain";
      log(`${d.title}: 발행 결과 확인 필요. 사이트 관리자에서 확인하세요.`);
      persist();
      throw Error(
        "발행 결과를 확정할 수 없습니다. 중복 방지를 위해 자동 재시도를 차단했습니다. 사이트 관리자에서 확인하고 발행 내역을 정리하세요.",
      );
    }
  });
  ipcMain.handle("reconcile", (_, v) => {
    const d = find(v.id);
    if (d.status !== "uncertain") throw Error("확인 대기 원고가 아닙니다.");
    if (v.url) {
      httpsUrl(v.url);
      d.status = "published";
      d.publishedUrl = v.url;
    } else {
      d.status = "draft";
      delete d.approval;
    }
    log(`${d.title}: 사용자가 발행 결과를 확인했습니다.`);
    persist();
    return publicState();
  });
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: "#101014",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
