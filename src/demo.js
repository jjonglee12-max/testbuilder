const key = "ai-blog-studio-preview-v1";
const seed = {
  drafts: [],
  sources: [],
  sites: [],
  logs: [],
  ai: { endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  prompt:
    "데스크톱 앱에서 상세 프롬프트를 불러옵니다. 브라우저는 화면 확인 모드입니다.",
};
const read = () =>
  JSON.parse(localStorage.getItem(key) || JSON.stringify(seed));
const write = (s) => {
  localStorage.setItem(key, JSON.stringify(s));
  return s;
};
export const preview = !window.studio;
export const api = window.studio || {
  load: async () => read(),
  saveDraft: async (d) => {
    const s = read();
    const item = {
      ...d,
      id: d.id || crypto.randomUUID(),
      status: "draft",
      updatedAt: new Date().toISOString(),
    };
    s.drafts = [item, ...s.drafts.filter((x) => x.id !== item.id)];
    write(s);
    return item;
  },
  deleteDraft: async (id) => {
    const s = read();
    s.drafts = s.drafts.filter((d) => d.id !== id);
    return write(s);
  },
  saveSite: async (site) => {
    if (site.credential)
      throw Error(
        "브라우저에서는 인증정보를 저장하지 않습니다. 데스크톱 앱을 실행하세요.",
      );
    const s = read();
    const value = { ...site, id: site.id || crypto.randomUUID() };
    s.sites = [value, ...s.sites.filter((v) => v.id !== value.id)];
    return write(s);
  },
  savePrompt: async (prompt) => {
    const s = read();
    s.prompt = prompt;
    return write(s);
  },
  saveWorkspace: async ({ name }) => {
    const s = read();
    s.workspace = { name };
    return write(s);
  },
  listAIModels: async () => {
    throw Error("모델 조회는 데스크톱 앱에서 사용하세요.");
  },
  testAI: async () => {
    throw Error("AI 연결 테스트는 데스크톱 앱에서 사용하세요.");
  },
  saveAI: async () => {
    throw Error("AI 연결은 데스크톱 앱에서 설정하세요.");
  },
  collectSources: async () => {
    throw Error("URL 수집은 데스크톱 앱에서 사용하세요.");
  },
  reviewDraft: async () => {
    throw Error("별도 AI 검토는 데스크톱 앱에서 사용하세요.");
  },
  generate: async () => {
    throw Error("AI 생성은 데스크톱 앱에서 연결 후 사용할 수 있습니다.");
  },
  testSite: async () => {
    throw Error("실제 연결 확인은 데스크톱 앱에서 가능합니다.");
  },
  approve: async () => {
    throw Error("실제 승인은 데스크톱 앱에서 가능합니다.");
  },
  publish: async () => {
    throw Error("실제 발행은 데스크톱 앱에서 가능합니다.");
  },
};
