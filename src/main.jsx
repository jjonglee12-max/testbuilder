import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  FileText,
  Library,
  Globe,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Search,
  Sparkles,
  ShieldCheck,
  Send,
  Save,
  Trash2,
  ChevronRight,
  BookOpen,
  PenLine,
  Link,
  Activity,
  AlertCircle,
} from "lucide-react";
import { api, preview } from "./demo";
import "./style.css";
import { Classification } from "./Classification";
import { Planning } from "./Planning";
import { PostLibrary } from "./PostLibrary";
import { RelatedLinks } from "./RelatedLinks";
const blank = () => ({
  title: "",
  body: "",
  topic: "",
  type: "도구 소개",
  sources: "",
  siteId: "",
  disclosure: "",
  sourceIds: [],
  categoryIds: [],
  tagIds: [],
  labels: [],
  images: [],
  publication: { mode: "now" },
});
const types = [
  "도구 소개",
  "사용법·문제 해결",
  "도구 비교",
  "AI 뉴스 해설",
  "실사용 리뷰",
  "개념·업무 활용",
];
const labels = {
  draft: "작성 중",
  approved: "승인 완료",
  published: "발행 완료",
  uncertain: "결과 확인 필요",
  publishing: "처리 중",
  queued: "로컬 예약",
  remote_scheduled: "플랫폼 예약 등록",
  missed: "시간 경과 · 보류",
};
function App() {
  const [data, setData] = useState(null),
    [page, setPage] = useState("dashboard"),
    [draft, setDraft] = useState(blank()),
    [tab, setTab] = useState("write"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [sourceUrls, setSourceUrls] = useState(""),
    [site, setSite] = useState({
      name: "",
      type: "wordpress",
      url: "",
      username: "",
      blogId: "",
      credential: "",
      profile: {
        topic: "AI 도구와 업무 활용",
        audience: "한국 직장인·개인 창작자",
        tone: "차분하고 친절한 존댓말",
        category: "",
        instructions: "",
      },
    }),
    [ai, setAi] = useState({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      credential: "",
    }),
    [workspaceName, setWorkspaceName] = useState("개인 워크스페이스"),
    [models, setModels] = useState([]),
    [prompt, setPrompt] = useState(""),
    [checked, setChecked] = useState(false);
  useEffect(() => {
    api
      .load()
      .then((s) => {
        setData(s);
        setWorkspaceName(s.workspace?.name || "개인 워크스페이스");
        setAi({ ...s.ai, credential: "" });
        setPrompt(s.prompt);
      })
      .catch((e) => setNotice(e.message));
  }, []);
  useEffect(() => {
    const batching = ["running", "stopping"].includes(data?.batch?.status);
    if (
      !batching &&
      !data?.drafts.some((d) => ["queued", "publishing"].includes(d.status))
    )
      return;
    const timer = setInterval(
      () => {
        api
          .load()
          .then((s) => {
            setData(s);
            setDraft((current) => {
              const saved = s.drafts.find((d) => d.id === current.id);
              return ["queued", "publishing"].includes(current.status) && saved
                ? saved
                : current;
            });
          })
          .catch(() => {});
      },
      batching ? 2000 : 15000,
    );
    return () => clearInterval(timer);
  }, [
    data?.drafts.some((d) => ["queued", "publishing"].includes(d.status)),
    data?.batch?.status,
  ]);
  async function run(fn) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e.message);
      try {
        const s = await api.load();
        setData(s);
        setDraft((current) => {
          const saved = s.drafts.find((d) => d.id === current.id);
          return saved &&
            [
              "published",
              "publishing",
              "uncertain",
              "queued",
              "remote_scheduled",
              "missed",
            ].includes(saved.status)
            ? saved
            : current;
        });
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const s = await api.load();
    setData(s);
    return s;
  }
  function edit(d) {
    if (busy) return;
    setDraft({ ...d });
    setChecked(false);
    setTab("write");
    setPage("editor");
  }
  function change(k, v) {
    if (
      [
        "published",
        "publishing",
        "uncertain",
        "queued",
        "remote_scheduled",
        "missed",
      ].includes(draft.status)
    ) {
      setNotice(
        "예약·발행 내역은 잠겨 있습니다. 예약을 취소하거나 새 원고로 복사하세요.",
      );
      return;
    }
    setDraft((d) => ({
      ...d,
      [k]: v,
      ...(k === "siteId" ? { categoryIds: [], tagIds: [], labels: [] } : {}),
      approval: undefined,
      reviewCurrent: [
        "publication",
        "categoryIds",
        "tagIds",
        "labels",
      ].includes(k)
        ? d.reviewCurrent
        : false,
      status: "draft",
    }));
    setChecked(false);
  }
  async function save() {
    const d = await api.saveDraft(draft);
    setDraft(d);
    await refresh();
    return d;
  }
  if (!data)
    return (
      <div className="loading">
        AI Blog Studio를 준비하고 있습니다… {notice}
      </div>
    );
  const published = data.drafts.filter((d) => d.status === "published"),
    pending = data.drafts.filter((d) => d.status === "draft"),
    approved = data.drafts.filter((d) => d.status === "approved");
  const reviewBlocked =
    (!!draft.generation && !draft.review) ||
    (!!draft.review &&
      (!draft.reviewCurrent || draft.review.verdict === "needs_changes"));
  const nav = [
    ["dashboard", LayoutDashboard, "대시보드"],
    ["drafts", FileText, "원고 보관함"],
    ["planning", PenLine, "주제 기획 · 일괄 준비"],
    ["posts", Link, "기존 발행 글"],
    ["sources", Library, "자료함"],
    ["schedule", Clock, "발행 일정"],
    ["editor", PenLine, "새 글 작성"],
    ["sites", Globe, "사이트 관리"],
    ["settings", Settings, "AI · 프롬프트"],
  ];
  const titles = {
    workspace: [
      "워크스페이스 설정",
      "내 편집 공간의 이름과 연결 상태를 관리하세요.",
    ],
    dashboard: [
      "작은 아이디어에서, 좋은 글까지.",
      "오늘의 콘텐츠 작업을 한곳에서 이어가세요.",
    ],
    planning: [
      "주제 기획과 일괄 준비",
      "주제를 모으고 자료 수집·초안·검토를 순서대로 준비하세요.",
    ],
    posts: [
      "기존 발행 글",
      "실제 게시물을 불러와 내부 링크와 중복 주제를 확인하세요.",
    ],
    schedule: [
      "발행 일정",
      "승인한 원고의 예약과 플랫폼 등록 결과를 관리하세요.",
    ],
    sources: ["자료함", "URL의 본문과 확인 시점을 보관하고 원고에 연결하세요."],
    drafts: ["원고 보관함", "아이디어부터 발행까지, 모든 원고의 기록입니다."],
    editor: [
      "글쓰기 스튜디오",
      "자료를 바탕으로 쓰고, 직접 확인한 뒤 발행하세요.",
    ],
    sites: ["사이트 관리", "내 블로그를 연결하고 발행할 곳을 관리하세요."],
    settings: [
      "나만의 편집 기준",
      "AI 연결과 블로그의 글쓰기 원칙을 설정하세요.",
    ],
  };
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="brand-icon">
            <BookOpen size={23} />
          </div>
          <div>
            blog<span>studio</span>
            <small>AI CONTENT WORKSPACE</small>
          </div>
        </div>
        <button
          className="workspace"
          onClick={() => setPage("workspace")}
          disabled={busy}
          aria-label="워크스페이스 설정"
        >
          <span className="avatar">나</span>
          <div>
            {data.workspace?.name || "개인 워크스페이스"}
            <small>로컬에 안전하게 보관</small>
          </div>
          <ChevronRight size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, Icon, name]) => (
            <button
              key={id}
              disabled={busy}
              className={page === id ? "active" : ""}
              onClick={() => {
                if (id === "editor") edit(blank());
                else setPage(id);
              }}
            >
              <Icon size={19} />
              {name}
              {id === "drafts" && <em>{data.drafts.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <b>발행은 내 결정으로</b>
          <p>
            AI가 초안을 준비하고,
            <br />
            마지막 확인은 내가 합니다.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="dot" />
          {preview ? "브라우저 화면 확인 모드" : "데스크톱 · 로컬 저장"}
          <small>AI Blog Studio · v0.4.0</small>
        </div>
      </aside>
      <div className="shell">
        <header>
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={13} />{" "}
            {nav.find((n) => n[0] === page)?.[2] || "워크스페이스 설정"}
          </div>
          <div className="header-right">
            <span className="pill">
              <span className="dot" /> 사람 승인 방식
            </span>
            <span className="avatar small">나</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR PERSONAL EDITORIAL DESK</div>
              <h1>{titles[page][0]}</h1>
              <p>{titles[page][1]}</p>
            </div>
            {page !== "editor" && (
              <button className="primary" onClick={() => edit(blank())}>
                <Plus size={17} />새 글 작성
              </button>
            )}
          </div>
          {preview && (
            <div className="preview-banner">
              <AlertCircle size={16} />
              화면 확인 모드입니다. 원고 편집은 가능하며, AI 연결·승인·실제
              발행은 데스크톱 앱에서 사용합니다.
            </div>
          )}
          {notice && (
            <div role="alert" className="notice">
              <AlertCircle size={18} />
              {notice}
              <button onClick={() => setNotice("")}>닫기</button>
            </div>
          )}
          {page === "dashboard" && (
            <>
              <section className="hero">
                <div>
                  <span className="hero-tag">
                    <Sparkles size={14} /> 생각을 정리하는 가장 좋은 시작
                  </span>
                  <h2>
                    어떤 이야기를
                    <br />
                    함께 써볼까요?
                  </h2>
                  <p>
                    AI 도구 리뷰부터 실용적인 사용법까지.
                    <br />내 기준으로 다듬어 나만의 콘텐츠를 만드세요.
                  </p>
                  <button className="dark-button" onClick={() => edit(blank())}>
                    첫 아이디어 적어보기 <ArrowRight size={16} />
                  </button>
                </div>
                <div className="hero-art">
                  <Sparkles className="art-star" size={180} strokeWidth={0.7} />
                  <div className="paper">
                    <div className="paper-icon">
                      <PenLine size={23} />
                    </div>
                    <span className="paper-line wide" />
                    <span className="paper-line" />
                    <span className="paper-line wide" />
                    <div className="paper-box">
                      <CheckCircle2 size={17} /> 내가 확인한, 좋은 콘텐츠
                    </div>
                  </div>
                  <div className="floating">
                    <Sparkles size={16} /> AI와 쓰고, 나답게 발행
                  </div>
                </div>
              </section>
              <section className="stats">
                {[
                  [
                    FileText,
                    "작성 중인 원고",
                    pending.length,
                    "아이디어를 글로 다듬는 중",
                    "purple",
                  ],
                  [
                    ShieldCheck,
                    "승인한 원고",
                    approved.length,
                    "최종 확인을 마친 콘텐츠",
                    "amber",
                  ],
                  [
                    Send,
                    "발행한 글",
                    published.length,
                    "블로그에 전달한 이야기",
                    "green",
                  ],
                  [
                    Globe,
                    "연결된 사이트",
                    data.sites.length,
                    "함께 운영하는 내 블로그",
                    "blue",
                  ],
                ].map(([Icon, label, count, hint, color]) => (
                  <div className="stat" key={label}>
                    <div className={"stat-icon " + color}>
                      <Icon size={19} />
                    </div>
                    <span>{label}</span>
                    <strong>
                      {count}
                      <small>개</small>
                    </strong>
                    <p>{hint}</p>
                  </div>
                ))}
              </section>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h3>
                      최근 작업한 원고 <span>{data.drafts.length}</span>
                    </h3>
                    <button
                      className="text-button"
                      onClick={() => setPage("drafts")}
                    >
                      전체 보기 <ArrowRight size={14} />
                    </button>
                  </div>
                  {data.drafts.length ? (
                    data.drafts
                      .slice(0, 5)
                      .map((d) => (
                        <DraftRow key={d.id} d={d} onClick={() => edit(d)} />
                      ))
                  ) : (
                    <div className="empty">
                      <div className="empty-icon">
                        <FileText size={26} />
                      </div>
                      <h3>첫 번째 이야기를 기다리고 있어요</h3>
                      <p>주제를 적거나 준비한 원고를 가져와 보세요.</p>
                      <button
                        className="text-button"
                        onClick={() => edit(blank())}
                      >
                        새 원고 만들기 <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel flow-panel">
                  <h3>좋은 글이 완성되는 과정</h3>
                  {[
                    [
                      "01",
                      "자료와 아이디어",
                      "참고 자료와 전달할 내용을 정리해요.",
                    ],
                    [
                      "02",
                      "AI 초안 · 나의 편집",
                      "글을 생성하거나 직접 작성해요.",
                    ],
                    [
                      "03",
                      "검토하고 승인",
                      "출처와 최종 내용을 직접 확인해요.",
                    ],
                    [
                      "04",
                      "내 블로그에 발행",
                      "승인한 버전만 사이트로 전달해요.",
                    ],
                  ].map(([n, t, p]) => (
                    <div className="flow" key={n}>
                      <span>{n}</span>
                      <div>
                        <b>{t}</b>
                        <p>{p}</p>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
              <div className="bottom-tip">
                <ShieldCheck size={16} />
                <span>
                  초안은 자동으로 발행되지 않습니다. 최종 원고를 확인하고 승인한
                  뒤 발행하세요.
                </span>
              </div>
            </>
          )}
          {page === "drafts" && (
            <section className="panel">
              <div className="section-heading">
                <h3>
                  모든 원고 <span>{data.drafts.length}</span>
                </h3>
                <div className="search">
                  <Search size={16} />
                  <input
                    placeholder="제목으로 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              {data.drafts
                .filter((d) => d.title.includes(query))
                .map((d) => (
                  <DraftRow key={d.id} d={d} onClick={() => edit(d)} />
                ))}
              {!data.drafts.length && (
                <div className="empty">
                  <FileText size={30} />
                  <h3>저장된 원고가 없습니다</h3>
                  <p>새 글 작성에서 첫 원고를 만들어보세요.</p>
                </div>
              )}
            </section>
          )}
          {page === "planning" && (
            <Planning
              data={data}
              api={api}
              run={run}
              onState={setData}
              onNotice={setNotice}
              onOpen={edit}
              busy={busy}
              types={types}
            />
          )}
          {page === "posts" && (
            <PostLibrary
              data={data}
              api={api}
              run={run}
              onState={setData}
              onNotice={setNotice}
              busy={busy}
            />
          )}
          {page === "schedule" && (
            <section className="panel padded">
              <h3>예약 원고</h3>
              <p className="hint">
                플랫폼 예약은 등록 후 앱을 꺼도 실행됩니다. WordPress는 사이트의
                예약 실행 기능(WP-Cron/서버 설정)에 따라 지연될 수 있습니다.
                로컬 예약은 앱이 실행 중이어야 하며, 5분 이상 늦거나 재시작 전에
                시간이 지난 작업은 자동 발행하지 않습니다. 표시는 한국
                시간(UTC+9)입니다.
              </p>
              {data.drafts.filter(
                (d) => d.publication?.mode && d.publication.mode !== "now",
              ).length === 0 && (
                <div className="empty">
                  <Clock size={30} />
                  <h3>예약한 원고가 없습니다</h3>
                  <p>
                    원고에서 발행 방식을 정하고 최종 승인 후 예약을 등록하세요.
                  </p>
                </div>
              )}
              {data.drafts
                .filter(
                  (d) => d.publication?.mode && d.publication.mode !== "now",
                )
                .sort(
                  (a, b) =>
                    Date.parse(a.publication.at) - Date.parse(b.publication.at),
                )
                .map((d) => (
                  <div className="schedule-row" key={d.id}>
                    <div>
                      <button className="text-button" onClick={() => edit(d)}>
                        {d.title || "제목 없는 원고"}
                      </button>
                      <small>
                        {koreanTime(d.publication.at)} ·{" "}
                        {d.publication.mode === "remote"
                          ? "플랫폼 예약"
                          : "앱 실행 필요"}
                      </small>
                      {d.deliveryError && (
                        <p className="hint">{d.deliveryError}</p>
                      )}
                    </div>
                    <span className={"status " + d.status}>
                      {labels[d.status]}
                    </span>
                    {["queued", "remote_scheduled", "missed"].includes(
                      d.status,
                    ) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            if (
                              !confirm(
                                d.status === "remote_scheduled"
                                  ? "플랫폼 예약을 취소하고 원격 글을 초안으로 돌릴까요?"
                                  : "로컬 예약을 해제할까요?",
                              )
                            )
                              return;
                            setData(await api.cancelSchedule(d.id));
                          })
                        }
                      >
                        예약 해제
                      </button>
                    )}
                    {d.remote?.id &&
                      ["remote_scheduled", "uncertain"].includes(d.status) && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              setData(await api.refreshRemote(d.id));
                              setNotice("플랫폼 상태를 조회했습니다.");
                            })
                          }
                        >
                          플랫폼 상태 조회
                        </button>
                      )}
                  </div>
                ))}
            </section>
          )}
          {page === "sources" && (
            <section className="panel padded">
              <h3>URL 자료 수집</h3>
              <p className="hint">
                공개 HTTPS 페이지를 한 번에 1~5개 읽습니다. 검색 엔진
                탐색·로그인 페이지·PDF·자바스크립트 렌더링은 지원하지 않습니다.
                수집은 사실 확인을 의미하지 않습니다.
              </p>
              <label>
                자료 URL (줄마다 하나)
                <textarea
                  rows={3}
                  value={sourceUrls}
                  onChange={(e) => setSourceUrls(e.target.value)}
                  placeholder="https://example.com/docs"
                />
              </label>
              <button
                className="primary"
                disabled={busy || !sourceUrls.trim()}
                onClick={() =>
                  run(async () => {
                    const r = await api.collectSources({ urls: sourceUrls });
                    setData(r.state);
                    setNotice(
                      `자료 ${r.ids.length}건 수집 완료${r.errors.length ? " · " + r.errors.map((v) => v.url + ": " + v.message).join(" / ") : ""}`,
                    );
                    if (!r.errors.length) setSourceUrls("");
                  })
                }
              >
                {busy ? "수집 중…" : "URL 본문 수집"}
              </button>
              <div className="source-list">
                {(data.sources || []).map((ref) => (
                  <details className="source-card" key={ref.id}>
                    <summary>
                      <b>{ref.title}</b>
                      <small>
                        {new Date(ref.fetchedAt).toLocaleString("ko-KR")} ·{" "}
                        {ref.text.length.toLocaleString()}자
                        {ref.truncated ? " · 일부만 저장" : ""}
                      </small>
                    </summary>
                    <p className="source-url">{ref.url}</p>
                    <p className="source-text">{ref.text}</p>
                    <p className="hint">내용 지문: {ref.contentHash}</p>
                  </details>
                ))}
                {!data.sources?.length && (
                  <p className="hint">
                    수집한 자료가 없습니다. 직접 읽은 자료는 원고의 참고
                    메모로도 추가할 수 있습니다.
                  </p>
                )}
              </div>
            </section>
          )}
          {page === "editor" && (
            <div className="editor-grid">
              <section className="panel editor">
                <div className="editor-toolbar">
                  <div className="tabs">
                    <button
                      className={tab === "write" ? "selected" : ""}
                      onClick={() => setTab("write")}
                    >
                      <PenLine size={15} />
                      편집
                    </button>
                    <button
                      className={tab === "preview" ? "selected" : ""}
                      onClick={() => setTab("preview")}
                    >
                      <BookOpen size={15} />
                      미리보기
                    </button>
                    <button
                      className={tab === "images" ? "selected" : ""}
                      onClick={() => setTab("images")}
                    >
                      <Library size={15} />
                      이미지 ({draft.images?.length || 0})
                    </button>
                  </div>
                  <span className={"status " + (draft.status || "draft")}>
                    {labels[draft.status] || "새 원고"}
                  </span>
                </div>
                {tab === "write" ? (
                  <>
                    <input
                      className="title-input"
                      readOnly={
                        busy ||
                        [
                          "published",
                          "publishing",
                          "uncertain",
                          "queued",
                          "remote_scheduled",
                          "missed",
                        ].includes(draft.status)
                      }
                      placeholder="이야기에 제목을 붙여주세요"
                      value={draft.title}
                      onChange={(e) => change("title", e.target.value)}
                    />
                    <textarea
                      className="body-input"
                      readOnly={
                        busy ||
                        [
                          "published",
                          "publishing",
                          "uncertain",
                          "queued",
                          "remote_scheduled",
                          "missed",
                        ].includes(draft.status)
                      }
                      placeholder={
                        "첫 문장을 적어보세요.\n\nAI로 초안을 만들려면 오른쪽에 주제와 참고 자료를 입력하세요.\n\n## 소제목\n빈 줄로 문단을 나눌 수 있습니다."
                      }
                      value={draft.body}
                      onChange={(e) => change("body", e.target.value)}
                    />
                  </>
                ) : tab === "images" ? (
                  <ImageEditor
                    draft={draft}
                    media={data.media || []}
                    busy={busy}
                    onChange={(value) => change("images", value)}
                    onError={setNotice}
                    onImport={(file) =>
                      run(async () => {
                        if (file.size > 10 * 1024 * 1024)
                          throw Error("10MB 이하 파일을 선택하세요.");
                        const r = await api.importImage({
                          name: file.name,
                          dataUrl: await fileData(file),
                        });
                        setData(r.state);
                        change("images", [
                          ...(draft.images || []),
                          {
                            id: crypto.randomUUID(),
                            assetId: r.assetId,
                            url: "",
                            alt: "",
                            caption: "",
                            position: "bottom",
                            featured: false,
                          },
                        ]);
                      })
                    }
                  />
                ) : (
                  <article className="article">
                    <h1>{draft.title || "제목 없는 원고"}</h1>
                    <ImagePreview
                      images={(draft.images || []).filter(
                        (i) => i.position === "top",
                      )}
                      media={data.media || []}
                    />
                    {draft.body
                      .split(/\n\n+/)
                      .map((p, i) =>
                        /^#{1,3} /.test(p) ? (
                          <h2 key={i}>{p.replace(/^#{1,3} /, "")}</h2>
                        ) : (
                          <p key={i}>{p}</p>
                        ),
                      )}
                    {!draft.body && <p>작성한 내용이 이곳에 표시됩니다.</p>}
                    <ImagePreview
                      images={(draft.images || []).filter(
                        (i) =>
                          i.position !== "top" &&
                          i.position !== "featured_only",
                      )}
                      media={data.media || []}
                    />
                  </article>
                )}
                <div className="editor-footer">
                  <span>
                    {draft.body.replace(/\s/g, "").length.toLocaleString()}자 ·
                    공백 제외
                  </span>
                  <button
                    disabled={
                      busy ||
                      [
                        "published",
                        "publishing",
                        "uncertain",
                        "queued",
                        "remote_scheduled",
                        "missed",
                      ].includes(draft.status)
                    }
                    className="secondary"
                    onClick={() =>
                      run(async () => {
                        await save();
                        setNotice("원고를 저장했습니다.");
                      })
                    }
                  >
                    <Save size={15} />
                    원고 저장
                  </button>
                </div>
              </section>
              <div className="editor-side">
                <section className="panel side-card">
                  <h3>
                    <Sparkles size={18} /> AI 작성 도우미
                  </h3>
                  <label>
                    글쓰기 기준 사이트
                    <select
                      value={draft.siteId}
                      onChange={(e) => change("siteId", e.target.value)}
                    >
                      <option value="">공통 편집 기준 사용</option>
                      {data.sites.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.siteId && (
                    <p className="hint">
                      {data.sites.find((s) => s.id === draft.siteId)?.profile
                        ?.audience || "기본 독자"}{" "}
                      ·{" "}
                      {data.sites.find((s) => s.id === draft.siteId)?.profile
                        ?.tone || "친절한 존댓말"}
                    </p>
                  )}
                  <label>
                    어떤 주제로 쓸까요?
                    <input
                      value={draft.topic}
                      onChange={(e) => change("topic", e.target.value)}
                      placeholder="예: AI 회의록 도구 선택 가이드"
                    />
                  </label>
                  <label>
                    글 유형
                    <select
                      value={draft.type}
                      onChange={(e) => change("type", e.target.value)}
                    >
                      {types.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    참고 자료 · 직접 사용 메모
                    <textarea
                      rows={5}
                      placeholder="직접 읽은 사실·사용 기록·조건을 적으세요. URL 본문은 아래 수집 기능을 사용하세요."
                      value={draft.sources}
                      onChange={(e) => change("sources", e.target.value)}
                    />
                  </label>
                  <label>
                    추가할 자료 URL
                    <textarea
                      rows={2}
                      value={sourceUrls}
                      onChange={(e) => setSourceUrls(e.target.value)}
                      placeholder="공식 문서 URL을 줄마다 입력"
                    />
                  </label>
                  <button
                    className="secondary full"
                    disabled={
                      busy ||
                      !sourceUrls.trim() ||
                      [
                        "published",
                        "publishing",
                        "uncertain",
                        "queued",
                        "remote_scheduled",
                        "missed",
                      ].includes(draft.status)
                    }
                    onClick={() =>
                      run(async () => {
                        const r = await api.collectSources({
                          urls: sourceUrls,
                        });
                        setData(r.state);
                        const combined = [
                          ...new Set([...(draft.sourceIds || []), ...r.ids]),
                        ];
                        if (combined.length > 8) {
                          setNotice(
                            "자료함에 저장했습니다. 원고에는 최대 8개 연결할 수 있으므로 보관 자료에서 직접 선택하세요.",
                          );
                          return;
                        }
                        change("sourceIds", combined);
                        setNotice(
                          `자료 ${r.ids.length}건 연결${r.errors.length ? " · " + r.errors.map((v) => v.message).join(" / ") : ""}`,
                        );
                        if (!r.errors.length) setSourceUrls("");
                      })
                    }
                  >
                    수집하고 원고에 연결
                  </button>
                  <details className="evidence-picker">
                    <summary>
                      보관 자료 선택 ({(draft.sourceIds || []).length}/8)
                    </summary>
                    {(data.sources || []).map((ref) => (
                      <label className="checkbox" key={ref.id}>
                        <input
                          type="checkbox"
                          checked={(draft.sourceIds || []).includes(ref.id)}
                          disabled={
                            busy ||
                            [
                              "published",
                              "publishing",
                              "uncertain",
                              "queued",
                              "remote_scheduled",
                              "missed",
                            ].includes(draft.status)
                          }
                          onChange={(e) => {
                            const ids = draft.sourceIds || [];
                            if (e.target.checked && ids.length >= 8) {
                              setNotice(
                                "한 원고에 자료는 최대 8개 연결할 수 있습니다.",
                              );
                              return;
                            }
                            change(
                              "sourceIds",
                              e.target.checked
                                ? [...ids, ref.id]
                                : ids.filter((id) => id !== ref.id),
                            );
                          }}
                        />
                        {ref.title}
                      </label>
                    ))}
                  </details>
                  <p className="hint">
                    자료는 설정한 AI 서비스로 전송됩니다. 개인정보와 비밀키를
                    넣지 마세요. 연결한 URL 자료와 메모가 함께 전송됩니다. 검색
                    엔진 탐색은 수행하지 않습니다.
                  </p>
                  <button
                    className="primary full"
                    disabled={
                      busy ||
                      !draft.topic.trim() ||
                      [
                        "published",
                        "publishing",
                        "uncertain",
                        "queued",
                        "remote_scheduled",
                        "missed",
                      ].includes(draft.status)
                    }
                    onClick={() =>
                      run(async () => {
                        if (
                          draft.body &&
                          !confirm(
                            "현재 본문을 AI 초안으로 교체할까요? 보존하려면 먼저 새 원고로 복사하세요.",
                          )
                        )
                          return;
                        const r = await api.generate(draft);
                        setDraft((d) => ({
                          ...d,
                          title: r.title,
                          body: r.body,
                          reviewNotes: r.notes || "",
                          generation: r.generation,
                          review: undefined,
                          reviewCurrent: false,
                          approval: undefined,
                          status: "draft",
                        }));
                        setChecked(false);
                        setNotice(
                          "초안 생성 완료 · 검토 메모: " +
                            (r.notes || "출처와 내용을 직접 확인하세요."),
                        );
                      })
                    }
                  >
                    <Sparkles size={16} />
                    {busy ? "처리 중…" : "AI 초안 만들기"}
                  </button>
                </section>
                <RelatedLinks
                  draft={draft}
                  api={api}
                  run={run}
                  onChange={(body) => change("body", body)}
                  onNotice={setNotice}
                  busy={busy}
                />
                <section className="panel side-card">
                  <h3>
                    <ShieldCheck size={18} /> 검토 및 발행
                  </h3>
                  <label>
                    발행 사이트
                    <select
                      value={draft.siteId}
                      onChange={(e) => change("siteId", e.target.value)}
                    >
                      <option value="">사이트 선택</option>
                      {data.sites.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Classification
                    site={data.sites.find((s) => s.id === draft.siteId)}
                    catalog={data.catalogs?.[draft.siteId]}
                    value={draft}
                    busy={
                      busy ||
                      [
                        "published",
                        "publishing",
                        "uncertain",
                        "queued",
                        "remote_scheduled",
                        "missed",
                      ].includes(draft.status)
                    }
                    onChange={(v) => {
                      change("categoryIds", v.categoryIds || []);
                      change("tagIds", v.tagIds || []);
                      change("labels", v.labels || []);
                    }}
                    onSync={() =>
                      run(async () => {
                        setData(await api.syncTaxonomy(draft.siteId));
                        setNotice("실제 사이트 분류를 불러왔습니다.");
                      })
                    }
                  />
                  <div className="review-note">
                    별도 AI 검토는 연결한 자료와 원고를 대조합니다. 검색을 통한
                    독립적 사실 보증은 아니며, 최종 확인과 발행 승인은 사람이
                    합니다.
                  </div>
                  <button
                    className="secondary full"
                    disabled={
                      busy ||
                      !draft.title.trim() ||
                      !draft.body.trim() ||
                      [
                        "published",
                        "publishing",
                        "uncertain",
                        "queued",
                        "remote_scheduled",
                        "missed",
                      ].includes(draft.status)
                    }
                    onClick={() =>
                      run(async () => {
                        const d = await save();
                        const next = await api.reviewDraft(d.id);
                        setData(next);
                        setDraft(next.drafts.find((v) => v.id === d.id));
                        setChecked(false);
                        setNotice(
                          "별도 AI 검토 완료. 지적 사항과 사실 목록을 확인하세요.",
                        );
                      })
                    }
                  >
                    {busy ? "검토 중…" : "별도 AI 검토 실행"}
                  </button>
                  <p className="hint">
                    별도 생성 요청으로 API 사용료가 발생합니다. AI 초안은 검토
                    후 승인할 수 있습니다.
                  </p>
                  {draft.review && (
                    <div className="review-report">
                      <b>
                        {!draft.reviewCurrent
                          ? "변경됨 · 재검토 필요"
                          : draft.review.verdict === "needs_changes"
                            ? "수정 필요"
                            : "사람 검토 가능"}
                      </b>
                      <p>{draft.review.summary}</p>
                      <small>
                        {draft.review.model} ·{" "}
                        {new Date(draft.review.at).toLocaleString("ko-KR")}
                      </small>
                      {draft.review.findings.map((f, i) => (
                        <div className={"finding " + f.severity} key={i}>
                          <b>
                            {
                              {
                                blocker: "차단",
                                warning: "주의",
                                suggestion: "제안",
                              }[f.severity]
                            }
                          </b>
                          <p>{f.message}</p>
                          {f.quote && <blockquote>{f.quote}</blockquote>}
                          {f.fix && <p>수정 방향: {f.fix}</p>}
                        </div>
                      ))}
                      <details>
                        <summary>
                          사실 목록 ({draft.review.claims.length})
                        </summary>
                        {draft.review.claims.map((c) => (
                          <div className="finding" key={c.id}>
                            <b>
                              {c.id} ·{" "}
                              {
                                {
                                  supported: "자료가 뒷받침함",
                                  unsupported: "자료와 불일치",
                                  uncertain: "확인 필요",
                                }[c.status]
                              }
                            </b>
                            <p>{c.claim}</p>
                            <p>{c.reason}</p>
                            {c.sourceIds.map((id) => (
                              <p className="source-url" key={id}>
                                {data.sources?.find((s) => s.id === id)?.url ||
                                  id}
                              </p>
                            ))}
                          </div>
                        ))}
                      </details>
                    </div>
                  )}
                  {draft.reviewNotes && (
                    <div
                      className="review-note"
                      style={{ marginTop: 10, whiteSpace: "pre-wrap" }}
                    >
                      <b>AI 검토 메모 (자기 보고)</b>
                      <br />
                      {draft.reviewNotes}
                    </div>
                  )}
                  <label>
                    발행 방식
                    <select
                      aria-label="발행 방식"
                      value={draft.publication?.mode || "now"}
                      onChange={(e) =>
                        change("publication", {
                          mode: e.target.value,
                          ...(e.target.value !== "now"
                            ? { at: draft.publication?.at || "" }
                            : {}),
                        })
                      }
                    >
                      <option value="now">즉시 공개 발행</option>
                      <option value="remote">
                        플랫폼에 예약 등록 (앱 종료 가능)
                      </option>
                      <option value="local">로컬 예약 (앱 실행 필요)</option>
                    </select>
                  </label>
                  {draft.publication?.mode &&
                    draft.publication.mode !== "now" && (
                      <>
                        <label>
                          예약 일시 · 한국 시간 (UTC+9)
                          <input
                            type="datetime-local"
                            value={koreanInput(draft.publication.at)}
                            onChange={(e) =>
                              change("publication", {
                                ...draft.publication,
                                at: e.target.value
                                  ? new Date(
                                      e.target.value + ":00+09:00",
                                    ).toISOString()
                                  : "",
                              })
                            }
                          />
                        </label>
                        <p className="hint">
                          {draft.publication.mode === "remote"
                            ? "승인 후 플랫폼에 예약 등록해야 합니다. 등록 성공 뒤에는 PC를 꺼도 됩니다."
                            : "예약 시간에 PC와 앱이 실행 중이어야 합니다. 재시작 전에 지난 예약은 보류합니다."}
                        </p>
                      </>
                    )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />
                    {draft.review
                      ? "AI 검토 내용과 최종 원고·대상 사이트를 확인했습니다."
                      : "AI 검토 미실행 상태에서 원고와 출처를 직접 검토했습니다."}
                  </label>
                  <button
                    className="secondary full"
                    disabled={
                      busy ||
                      !checked ||
                      reviewBlocked ||
                      [
                        "published",
                        "publishing",
                        "uncertain",
                        "queued",
                        "remote_scheduled",
                        "missed",
                      ].includes(draft.status)
                    }
                    onClick={() =>
                      run(async () => {
                        const d = await save();
                        const s = await api.approve(d.id);
                        setData(s);
                        setDraft(s.drafts.find((x) => x.id === d.id));
                        setNotice(
                          "이 버전의 원고를 승인했습니다. 실제 발행은 아래 버튼으로 진행하세요.",
                        );
                      })
                    }
                  >
                    <Check size={16} />이 원고 승인
                  </button>
                  <button
                    className="primary full publish"
                    disabled={
                      busy || draft.status !== "approved" || reviewBlocked
                    }
                    onClick={() =>
                      run(async () => {
                        const s = data.sites.find((s) => s.id === draft.siteId);
                        if (
                          !confirm(
                            draft.publication?.mode &&
                              draft.publication.mode !== "now"
                              ? `“${s?.name}”에 “${draft.title}”을 ${koreanTime(draft.publication.at)}에 ${draft.publication.mode === "remote" ? "플랫폼 예약 등록" : "로컬 예약"}합니다. 진행할까요?`
                              : `“${s?.name}”에 “${draft.title}”을 공개 발행합니다. 진행할까요?`,
                          )
                        )
                          return;
                        const saved = await save();
                        const next = await (saved.publication?.mode &&
                        saved.publication.mode !== "now"
                          ? api.scheduleDraft(saved.id)
                          : api.publish(saved.id));
                        setData(next);
                        setDraft(next.drafts.find((d) => d.id === saved.id));
                        setNotice(
                          saved.publication?.mode &&
                            saved.publication.mode !== "now"
                            ? "예약 등록 결과를 확인하세요. 발행 일정에서 관리할 수 있습니다."
                            : "발행 완료. 원격 게시 주소를 저장했습니다.",
                        );
                      })
                    }
                  >
                    <Send size={16} />
                    {draft.publication?.mode && draft.publication.mode !== "now"
                      ? "승인한 원고 예약 등록"
                      : "블로그에 공개 발행"}
                  </button>
                  {draft.deliveryError && (
                    <div className="review-note">{draft.deliveryError}</div>
                  )}
                  {["queued", "remote_scheduled", "missed"].includes(
                    draft.status,
                  ) && (
                    <button
                      className="secondary full"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (
                            !confirm(
                              "예약을 해제할까요? 플랫폼 예약은 원격 글을 초안으로 돌립니다.",
                            )
                          )
                            return;
                          const next = await api.cancelSchedule(draft.id);
                          setData(next);
                          setDraft(next.drafts.find((d) => d.id === draft.id));
                        })
                      }
                    >
                      예약 해제 후 편집
                    </button>
                  )}
                  {draft.remote?.id &&
                    ["remote_scheduled", "uncertain"].includes(
                      draft.status,
                    ) && (
                      <button
                        className="secondary full"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const next = await api.refreshRemote(draft.id);
                            setData(next);
                            setDraft(
                              next.drafts.find((d) => d.id === draft.id),
                            );
                          })
                        }
                      >
                        플랫폼 상태 조회
                      </button>
                    )}
                  {draft.publishedUrl && (
                    <p className="hint">발행 주소: {draft.publishedUrl}</p>
                  )}
                  {draft.status === "uncertain" &&
                    !(
                      draft.remote?.id && draft.publication?.mode === "remote"
                    ) && (
                      <button
                        className="secondary full"
                        onClick={() =>
                          run(async () => {
                            const url = promptResult();
                            if (url === null) return;
                            const s = await api.reconcile(draft.id, url);
                            setData(s);
                            setDraft(s.drafts.find((d) => d.id === draft.id));
                          })
                        }
                      >
                        사이트에서 확인 후 결과 정리
                      </button>
                    )}
                  <button
                    className="text-button"
                    onClick={() =>
                      edit({
                        ...draft,
                        id: undefined,
                        title: draft.title + " (복사)",
                        status: "draft",
                        approval: undefined,
                        publishedUrl: undefined,
                        publication: { mode: "now" },
                        remote: undefined,
                        deliveryError: undefined,
                        deliveryPhase: undefined,
                      })
                    }
                  >
                    새 원고로 복사
                  </button>
                </section>
              </div>
            </div>
          )}
          {page === "sites" && (
            <div className="settings-grid">
              <section className="panel padded">
                <h3>연결한 사이트</h3>
                {!data.sites.length && (
                  <div className="empty">
                    <Globe size={30} />
                    <h3>첫 블로그를 연결하세요</h3>
                    <p>WordPress와 Blogger를 지원합니다.</p>
                  </div>
                )}
                {data.sites.map((s) => (
                  <div className="site-row" key={s.id}>
                    <div className="site-logo">
                      {s.type === "wordpress" ? "W" : "B"}
                    </div>
                    <div>
                      <b>{s.name}</b>
                      <small>{s.url || "Blogger · " + s.blogId}</small>
                      <small>
                        {s.hasSecret ? "인증정보 저장됨" : "인증정보 없음"}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setSite({ ...s, credential: "" })}
                    >
                      수정
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          setData(await api.testSite(s.id));
                          setNotice(
                            "읽기 연결을 확인했습니다. 게시 권한은 실제 발행 시 확인합니다.",
                          );
                        })
                      }
                    >
                      연결 확인
                    </button>
                  </div>
                ))}
              </section>
              <section className="panel padded">
                <h3>
                  <Plus size={18} />
                  {site.id ? "사이트 수정" : "사이트 추가"}
                </h3>
                <label>
                  사이트 이름
                  <input
                    value={site.name}
                    onChange={(e) => setSite({ ...site, name: e.target.value })}
                    placeholder="나의 AI 블로그"
                  />
                </label>
                <label>
                  플랫폼
                  <select
                    value={site.type}
                    onChange={(e) => setSite({ ...site, type: e.target.value })}
                  >
                    <option value="wordpress">
                      WordPress (자체 호스팅 REST API)
                    </option>
                    <option value="blogger">Blogger / 블로그스팟</option>
                  </select>
                </label>
                {site.type === "wordpress" ? (
                  <>
                    <label>
                      사이트 주소
                      <input
                        placeholder="https://my-blog.com"
                        value={site.url}
                        onChange={(e) =>
                          setSite({ ...site, url: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      사용자명
                      <input
                        value={site.username}
                        onChange={(e) =>
                          setSite({ ...site, username: e.target.value })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    블로그 ID
                    <input
                      value={site.blogId}
                      onChange={(e) =>
                        setSite({ ...site, blogId: e.target.value })
                      }
                      placeholder="Blogger 관리자 주소의 숫자 ID"
                    />
                  </label>
                )}
                <fieldset className="profile-fields">
                  <legend>이 블로그의 글쓰기 기준</legend>
                  {[
                    ["topic", "주요 주제"],
                    ["audience", "대상 독자"],
                    ["tone", "말투"],
                    ["category", "기본 콘텐츠 분류 (편집용)"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        value={site.profile?.[key] || ""}
                        onChange={(e) =>
                          setSite({
                            ...site,
                            profile: { ...site.profile, [key]: e.target.value },
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    추가 편집 지침
                    <textarea
                      rows={4}
                      value={site.profile?.instructions || ""}
                      placeholder="예: 초보자도 따라 할 수 있는 업무 예시를 포함하세요."
                      onChange={(e) =>
                        setSite({
                          ...site,
                          profile: {
                            ...site.profile,
                            instructions: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <p className="hint">
                    글 생성과 별도 검토에 적용됩니다. 분류는 현재 편집 기준이며
                    원격 카테고리 지정 기능은 아닙니다.
                  </p>
                </fieldset>
                <label>
                  {site.type === "wordpress"
                    ? "Application Password"
                    : "Google OAuth 액세스 토큰"}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={site.credential}
                    onChange={(e) =>
                      setSite({ ...site, credential: e.target.value })
                    }
                  />
                </label>
                <p className="hint">
                  {site.type === "wordpress"
                    ? "WordPress 사용자 프로필에서 발급한 애플리케이션 비밀번호를 사용하세요. 일반 로그인 비밀번호를 입력하지 마세요."
                    : "현재는 수동 OAuth 토큰 연결 방식입니다. blogger 권한이 필요하며 토큰 만료 시 재등록해야 합니다. 자동 로그인·갱신은 후속 기능입니다."}{" "}
                  인증정보는 데스크톱 운영체제 보안 저장소로 암호화합니다.
                </p>
                <button
                  className="primary"
                  disabled={busy || !site.name.trim()}
                  onClick={() =>
                    run(async () => {
                      setData(await api.saveSite(site));
                      setSite({
                        name: "",
                        type: "wordpress",
                        url: "",
                        username: "",
                        blogId: "",
                        credential: "",
                      });
                      setNotice(
                        "사이트를 저장했습니다. 연결 확인을 실행하세요.",
                      );
                    })
                  }
                >
                  <Plus size={16} />
                  사이트 저장
                </button>
              </section>
            </div>
          )}
          {page === "workspace" && (
            <section className="panel padded">
              <h3>워크스페이스</h3>
              <p className="hint">
                현재 버전은 하나의 개인 작업 공간을 사용합니다. 이름을 변경해도
                기존 원고·사이트·AI 설정은 유지됩니다.
              </p>
              <label>
                워크스페이스 이름
                <input
                  maxLength={40}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !workspaceName.trim()}
                onClick={() =>
                  run(async () => {
                    setData(await api.saveWorkspace({ name: workspaceName }));
                    setNotice("워크스페이스 이름을 저장했습니다.");
                  })
                }
              >
                이름 저장
              </button>
              <hr />
              <p>
                보관 원고 {data.drafts.length}개 · 연결 사이트{" "}
                {data.sites.length}개
              </p>
              <button className="secondary" onClick={() => setPage("settings")}>
                AI 연결 설정 열기
              </button>{" "}
              <button className="secondary" onClick={() => setPage("sites")}>
                사이트 관리 열기
              </button>
            </section>
          )}
          {page === "settings" && (
            <>
              <section className="panel padded ai-settings">
                <h3>
                  <Sparkles size={18} /> AI API 연결
                </h3>
                <p className="hint">
                  OpenAI 호환 Chat Completions API를 사용합니다. 구독형 ChatGPT
                  로그인과 별개이며 API 사용료가 발생할 수 있습니다. Codex CLI
                  연결은 아직 지원하지 않습니다.
                </p>
                <div className="review-note">
                  ① API 기본 주소·모델·키 입력 → ② 모델 목록 확인(선택) → ③ 연결
                  테스트 후 저장. ChatGPT 로그인 계정이 아닌 별도 API 키가
                  필요합니다.
                </div>
                <div className="form-row">
                  <label>
                    API 기본 주소
                    <input
                      value={ai.endpoint}
                      onChange={(e) =>
                        setAi({ ...ai, endpoint: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    모델 ID
                    <input
                      list="ai-models"
                      value={ai.model}
                      onChange={(e) => setAi({ ...ai, model: e.target.value })}
                    />
                  </label>
                  <label>
                    API 키 {data.ai.hasSecret ? "(저장됨)" : ""}
                    <input
                      type="password"
                      value={ai.credential}
                      onChange={(e) =>
                        setAi({ ...ai, credential: e.target.value })
                      }
                      placeholder="변경할 때만 입력"
                    />
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setData(await api.saveAI(ai));
                      setAi({ ...ai, credential: "" });
                      setNotice("AI 설정을 저장했습니다.");
                    })
                  }
                >
                  설정만 저장
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const values = await api.listAIModels(ai);
                      setModels(values);
                      setNotice(
                        `모델 ${values.length}개를 조회했습니다. 모델 ID 입력란에서 선택하세요.`,
                      );
                    })
                  }
                >
                  모델 목록 불러오기
                </button>
                <datalist id="ai-models">
                  {models.map((id) => (
                    <option value={id} key={id} />
                  ))}
                </datalist>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (
                        !window.confirm(
                          "선택한 AI 서비스에 짧은 생성 요청을 보내 연결을 확인합니다. 소액 API 사용료가 발생할 수 있습니다. 진행할까요?",
                        )
                      )
                        return;
                      const next = await api.testAI(ai);
                      setData(next);
                      setAi({ ...next.ai, credential: "" });
                      setNotice(
                        "AI 연결·실제 생성 응답을 확인하고 설정을 저장했습니다.",
                      );
                    })
                  }
                >
                  {busy ? "확인 중…" : "연결 테스트 후 저장"}
                </button>
                <p className="hint">
                  {data.ai.testedAt
                    ? `마지막 생성 응답 확인: ${new Date(data.ai.testedAt).toLocaleString("ko-KR")}`
                    : data.ai.hasSecret
                      ? "키 저장됨 · 실제 생성 연결은 아직 확인하지 않았습니다."
                      : "API 키 미등록 · 연결 테스트를 진행하세요."}
                </p>
              </section>
              <section className="panel padded prompt-panel">
                <div className="section-heading">
                  <div>
                    <h3>AI 블로그 편집 프롬프트</h3>
                    <p className="hint">
                      원칙은 유지하고, 내 블로그에 맞춰 조정하세요. 수정 내용은
                      이후 생성부터 적용됩니다.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setData(await api.savePrompt(prompt));
                        setNotice("프롬프트를 저장했습니다.");
                      })
                    }
                  >
                    <Save size={16} />
                    프롬프트 저장
                  </button>
                </div>
                <textarea
                  className="prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </section>
            </>
          )}
        </main>
        <footer>
          내 생각에 AI의 도움을 더하다.
          <span>로컬 우선 · 사람 승인 · 나만의 편집 기준</span>
        </footer>
      </div>
    </div>
  );
}
function koreanTime(at) {
  return Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "예약 시간 미정";
}
function koreanInput(at) {
  return Number.isFinite(Date.parse(at))
    ? new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 16)
    : "";
}
function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("이미지 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
function ImagePreview({ images, media }) {
  return images.map((i) => (
    <figure className="image-preview" key={i.id}>
      {i.assetId ? (
        <img src={media.find((m) => m.id === i.assetId)?.preview} alt={i.alt} />
      ) : (
        <div className="external-image">
          외부 이미지 URL · 발행 시 사용
          <br />
          {i.url}
        </div>
      )}
      <figcaption>
        {i.caption || i.alt}
        {i.featured ? " · WordPress 대표 이미지" : ""}
      </figcaption>
    </figure>
  ));
}
function ImageEditor({ draft, media, busy, onChange, onImport, onError }) {
  const [url, setUrl] = useState(""),
    [alt, setAlt] = useState(""),
    [assetId, setAssetId] = useState("");
  const locked =
    busy ||
    [
      "published",
      "publishing",
      "uncertain",
      "queued",
      "remote_scheduled",
      "missed",
    ].includes(draft.status);
  const list = draft.images || [];
  function add(value) {
    if (list.length >= 10) {
      onError("이미지는 최대 10개 추가할 수 있습니다.");
      return;
    }
    onChange([
      ...list,
      {
        id: crypto.randomUUID(),
        caption: "",
        position: "bottom",
        featured: false,
        ...value,
      },
    ]);
  }
  function update(id, values) {
    onChange(
      list.map((i) =>
        i.id === id
          ? { ...i, ...values }
          : values.featured
            ? { ...i, featured: false }
            : i,
      ),
    );
  }
  return (
    <section className="image-editor">
      <h3>원고 이미지</h3>
      <p className="hint">
        PNG·JPEG·WebP 파일을 보관하고 WordPress 발행 시 업로드합니다. Blogger는
        이미 호스팅된 HTTPS 이미지 URL을 사용하세요. 실제 이미지와 출처·사용
        권한은 사람이 확인해야 하며 AI 검토에는 대체 텍스트·캡션만 전달됩니다.
      </p>
      <label>
        PC에서 이미지 추가 (최대 10MB)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={locked || list.length >= 10}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
      </label>
      <div className="form-row">
        <label>
          보관한 이미지
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">선택</option>
            {media.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={locked || !assetId}
          onClick={() => add({ assetId, url: "", alt: "" })}
        >
          보관 이미지 추가
        </button>
      </div>
      <label>
        외부 이미지 HTTPS 주소
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://my-site.com/image.png"
        />
      </label>
      <label>
        외부 이미지 대체 텍스트
        <input
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="이미지가 전달하는 내용을 설명하세요"
        />
      </label>
      <button
        className="secondary"
        disabled={locked || !url || !alt}
        onClick={() => {
          try {
            if (new URL(url).protocol !== "https:") throw Error();
            add({ assetId: "", url, alt });
            setUrl("");
            setAlt("");
          } catch {
            onError("HTTPS 이미지 주소를 입력하세요.");
          }
        }}
      >
        외부 이미지 추가
      </button>
      {list.map((i, index) => (
        <div className="image-item" key={i.id}>
          <ImagePreview images={[i]} media={media} />
          <label>
            대체 텍스트
            <input
              value={i.alt}
              disabled={locked}
              onChange={(e) => update(i.id, { alt: e.target.value })}
            />
          </label>
          <label>
            캡션
            <textarea
              value={i.caption}
              rows={2}
              disabled={locked}
              onChange={(e) => update(i.id, { caption: e.target.value })}
            />
          </label>
          <label>
            본문 배치
            <select
              value={i.position}
              disabled={locked}
              onChange={(e) => update(i.id, { position: e.target.value })}
            >
              <option value="top">본문 위</option>
              <option value="bottom">본문 아래</option>
              {i.assetId && (
                <option value="featured_only" disabled={!i.featured}>
                  대표 이미지로만 사용
                </option>
              )}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={i.featured}
              disabled={locked || !i.assetId}
              onChange={(e) =>
                update(i.id, {
                  featured: e.target.checked,
                  ...(!e.target.checked && i.position === "featured_only"
                    ? { position: "bottom" }
                    : {}),
                })
              }
            />
            WordPress 대표 이미지
          </label>
          <div className="image-actions">
            <button
              className="secondary"
              disabled={locked || index === 0}
              onClick={() => {
                const next = [...list];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}
            >
              위로
            </button>
            <button
              className="secondary"
              disabled={locked || index === list.length - 1}
              onClick={() => {
                const next = [...list];
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                onChange(next);
              }}
            >
              아래로
            </button>
            <button
              className="secondary"
              disabled={locked}
              onClick={() => onChange(list.filter((v) => v.id !== i.id))}
            >
              원고에서 제거
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
function promptResult() {
  return window.prompt(
    "사이트 관리자에서 먼저 확인하세요. 발행되었으면 게시 주소를 입력하세요. 게시되지 않은 것을 확인했다면 빈칸으로 확인하면 초안으로 돌아갑니다.",
  );
}
function DraftRow({ d, onClick }) {
  return (
    <button className="draft-row" onClick={onClick}>
      <span className="draft-icon">
        <FileText size={19} />
      </span>
      <div>
        <b>{d.title || "제목 없는 원고"}</b>
        <small>
          {d.type} · {new Date(d.updatedAt).toLocaleDateString("ko-KR")}
        </small>
      </div>
      <span className={"status " + d.status}>{labels[d.status]}</span>
      <ChevronRight size={16} />
    </button>
  );
}
createRoot(document.getElementById("root")).render(<App />);
