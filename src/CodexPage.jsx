import React, { useEffect, useState } from "react";
const active = (job) => ["running", "stopping"].includes(job?.status);
const names = {
  running: "진행 중",
  stopping: "중지 중",
  completed: "완료",
  failed: "실패",
  stopped: "중지됨",
  interrupted: "앱 종료로 중단",
};
export function CodexProgress({
  job,
  api,
  onState,
  onNotice,
  compact = false,
}) {
  const [stopping, setStopping] = useState(false);
  async function stop() {
    setStopping(true);
    try {
      onState(await api.stopCodex());
      onNotice(
        "Codex 중지를 요청했습니다. 이미 사용한 이용량은 반환되지 않을 수 있습니다.",
      );
    } catch (e) {
      onNotice(e.message);
    } finally {
      setStopping(false);
    }
  }
  if (!job) return null;
  return (
    <section
      className={"codex-progress " + (compact ? "compact" : "panel padded")}
      aria-live="polite"
    >
      <div className="button-row">
        <b>Codex · {names[job.status] || job.status}</b>
        {active(job) && (
          <button
            className="danger"
            disabled={stopping || job.status === "stopping"}
            onClick={stop}
          >
            Codex 작업 중지
          </button>
        )}
      </div>
      <p>{job.stage}</p>
      {job.error && <p className="review-note">{job.error}</p>}
      {!compact && (
        <>
          <p className="hint">
            {job.model === "default" ? "Codex 기본 모델" : job.model} ·{" "}
            {job.webSearch ? "웹 검색 허용" : "제공된 자료만 사용"}
            {job.usage
              ? ` · 입력 ${job.usage.inputTokens.toLocaleString()} / 출력 ${job.usage.outputTokens.toLocaleString()} 토큰 (요금·잔여 한도 표시 아님)`
              : ""}
          </p>
          <details>
            <summary>진행 기록</summary>
            {(job.events || []).map((e, i) => (
              <p className="hint" key={i}>
                {new Date(e.at).toLocaleTimeString("ko-KR")} · {e.message}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
function Settings({ data, api, run, onState, onNotice, busy }) {
  const [settings, setSettings] = useState(
    data.codex || { executable: "", model: "", webSearch: false },
  );
  useEffect(
    () =>
      setSettings(
        data.codex || { executable: "", model: "", webSearch: false },
      ),
    [data.codex?.executable, data.codex?.model, data.codex?.webSearch],
  );
  const c = data.codex?.connection,
    locked = busy || active(data.codexJob);
  return (
    <section className="panel padded">
      <h3>로컬 Codex 연결</h3>
      <p className="hint">
        Codex CLI를 별도로 설치하고 같은 PC 사용자 계정의 터미널에서
        로그인하세요. 앱이 로그인 토큰을 읽거나 복사하지 않습니다. ChatGPT 구독
        이용 범위 또는 Codex에 로그인한 API 계정의 비용·한도가 적용됩니다.
      </p>
      <details>
        <summary>처음 연결하는 방법</summary>
        <ol>
          <li>
            공식 안내에 따라 Codex CLI를 설치합니다. Node.js 설치 환경에서는{" "}
            <code>npm install -g @openai/codex</code>를 사용할 수 있습니다.
          </li>
          <li>
            새 터미널에서 <code>codex login</code>을 실행합니다. 브라우저
            로그인이 어려우면 <code>codex login --device-auth</code>를
            사용합니다.
          </li>
          <li>
            앱을 다시 열고 아래의 ‘설정 저장·연결 확인’을 누릅니다. Windows npm
            설치도 실제 codex.exe를 자동 탐색하며 찾지 못하면 직접 선택합니다.
          </li>
        </ol>
        <button
          className="text-button"
          onClick={() => run(() => api.codexDocs())}
        >
          공식 설치·로그인 안내 열기
        </button>
      </details>
      <label>
        Codex 실행 파일 경로 (비우면 자동 탐색)
        <input
          value={settings.executable || ""}
          onChange={(e) =>
            setSettings({ ...settings, executable: e.target.value })
          }
          placeholder="Windows는 codex.exe, macOS/Linux는 codex 실행 파일"
        />
      </label>
      <button
        className="secondary"
        disabled={locked}
        onClick={() =>
          run(async () => {
            const r = await api.chooseCodex();
            if (!r.cancelled) setSettings({ ...settings, executable: r.path });
          })
        }
      >
        실행 파일 선택
      </button>
      <label>
        Codex 모델 ID (비우면 Codex 기본값)
        <input
          value={settings.model || ""}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
          placeholder="사용 가능한 모델 ID를 입력하거나 비워두세요"
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={!!settings.webSearch}
          onChange={(e) =>
            setSettings({ ...settings, webSearch: e.target.checked })
          }
        />
        자연어 작업에서 웹 검색 선택 허용
      </label>
      <p className="hint">
        초안 생성·별도 검토·기존 글 수정·일괄 준비는 선택한 보관 자료만
        사용합니다. 웹 검색은 이 화면에서 작업별로 켭니다. 개인 CLI 설정·MCP·앱
        연결·셸 도구를 사용하지 않고 별도 임시 작업 폴더에서 실행합니다.
      </p>
      <div className="button-row">
        <button
          className="primary"
          disabled={locked}
          onClick={() =>
            run(async () => {
              onState(await api.saveCodex(settings));
              try {
                const result = await api.testCodex();
                onNotice(
                  result.loggedIn
                    ? "Codex 설치·로그인 확인 완료. 작업 엔진을 선택하세요."
                    : "Codex는 설치됐지만 로그인이 필요합니다. 터미널에서 로그인한 뒤 다시 확인하세요.",
                );
              } finally {
                onState(await api.load());
              }
            })
          }
        >
          설정 저장·연결 확인
        </button>
        <span className="pill">
          {c?.loggedIn
            ? `${c.version} · ${c.auth}`
            : c?.error
              ? "연결 확인 실패"
              : c?.checkedAt
                ? "로그인 필요"
                : "아직 확인하지 않음"}
        </span>
      </div>
      {c?.error && <p className="review-note">{c.error}</p>}
      <label>
        초안·검토·수정·일괄 준비의 작업 엔진
        <select
          value={data.aiEngine || "api"}
          disabled={locked}
          onChange={(e) =>
            run(async () => {
              onState(await api.setAIEngine(e.target.value));
              onNotice(
                "작업 엔진을 변경했습니다. 기존 원고와 API 설정은 유지됩니다.",
              );
            })
          }
        >
          <option value="api">기존 AI API</option>
          <option value="codex" disabled={!c?.loggedIn}>
            로컬 Codex
          </option>
        </select>
      </label>
    </section>
  );
}
export function CodexPage({ data, api, run, onState, onOpen, onNotice, busy }) {
  const [request, setRequest] = useState(""),
    [siteId, setSiteId] = useState(data.sites[0]?.id || ""),
    [sourceIds, setSourceIds] = useState([]),
    [draftId, setDraftId] = useState(""),
    [webSearch, setWebSearch] = useState(false);
  const job = data.codexJob,
    locked = busy || active(job),
    result =
      job?.kind === "task" && job.status === "completed" ? job.result : null;
  return (
    <div className="codex-layout">
      <Settings {...{ data, api, run, onState, onNotice, busy }} />
      <section className="panel padded">
        <h3>Codex에게 작업 요청</h3>
        <p className="hint">
          주제 제안, 공식 자료 조사, 초안 작성·개선을 요청하세요. 한 번에 한
          작업을 진행하며 발행·예약은 수행하지 않습니다. 새 요청을 시작하면 이전
          작업 결과 화면이 교체되므로 필요한 원고는 먼저 가져오세요.
        </p>
        <label>
          글쓰기 기준 사이트
          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setDraftId("");
            }}
            disabled={locked}
          >
            <option value="">사이트 선택</option>
            {data.sites.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          참고할 원고 (원본은 유지)
          <select
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            disabled={locked}
          >
            <option value="">참고 원고 없음</option>
            {data.drafts
              .filter((d) => d.siteId === siteId && d.format !== "html")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || "제목 없음"}
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend>보관 자료 선택 ({sourceIds.length}/8)</legend>
          <div className="codex-source-list">
            {data.sources.map((s) => (
              <label className="checkbox" key={s.id}>
                <input
                  type="checkbox"
                  disabled={
                    locked ||
                    (sourceIds.length >= 8 && !sourceIds.includes(s.id))
                  }
                  checked={sourceIds.includes(s.id)}
                  onChange={(e) =>
                    setSourceIds(
                      e.target.checked
                        ? [...sourceIds, s.id]
                        : sourceIds.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.title || s.url}
              </label>
            ))}
            {!data.sources.length && (
              <p className="hint">
                자료함에서 URL 본문을 먼저 수집하면 근거로 선택할 수 있습니다.
              </p>
            )}
          </div>
        </fieldset>
        <label>
          작업 요청
          <textarea
            rows={6}
            value={request}
            maxLength={12000}
            disabled={locked}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="AI 입문자를 위한 주제 5개를 제안해줘. 또는 선택한 자료를 바탕으로 업무 활용 안내 글을 작성하고 불확실한 주장은 따로 남겨줘."
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={locked || !data.codex?.webSearch}
            checked={webSearch && !!data.codex?.webSearch}
            onChange={(e) => setWebSearch(e.target.checked)}
          />
          이번 작업에 웹 검색 사용 (연결 설정에서 허용 필요)
        </label>
        <button
          className="primary"
          disabled={
            locked ||
            !request.trim() ||
            !siteId ||
            !data.codex?.connection?.loggedIn
          }
          onClick={() =>
            run(async () => {
              if (
                !window.confirm(
                  "요청·선택한 자료·참고 원고와 편집 지침을 Codex에 전송합니다. Codex 계정 이용량이 발생합니다. 결과를 준비하고 승인·발행은 하지 않습니다. 시작할까요?",
                )
              )
                return;
              onState(
                await api.startCodexTask({
                  request,
                  siteId,
                  sourceIds,
                  draftId,
                  webSearch,
                }),
              );
              onNotice(
                "Codex 작업을 시작했습니다. 진행 중 다른 화면으로 이동해도 계속되며 앱을 종료하면 중단됩니다.",
              );
            })
          }
        >
          Codex 작업 시작
        </button>
      </section>
      <CodexProgress {...{ job, api, onState, onNotice }} />
      {result && (
        <section className="panel padded codex-result">
          <h3>작업 결과</h3>
          <p className="preserve-lines">{result.summary}</p>
          {result.warnings?.length > 0 && (
            <div className="review-note">
              <b>확인할 사항</b>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {result.topics?.map((topic, i) => (
            <div className="backup-row" key={i}>
              <h4>{topic.title}</h4>
              <p>{topic.angle}</p>
              <p className="source-url">{topic.sourceUrls.join("\n")}</p>
              <button
                className="secondary"
                disabled={locked}
                onClick={() =>
                  run(async () => {
                    onState(
                      await api.savePlan({
                        topic: topic.title,
                        type: "개념·업무 활용",
                        siteId: job.context.siteId,
                        notes: [topic.angle, ...topic.sourceUrls].join("\n"),
                        sourceIds: job.context.sourceIds,
                        urls: "",
                        categoryIds: [],
                        tagIds: [],
                        labels: [],
                      }),
                    );
                    onNotice(
                      "주제를 기획에 추가했습니다. 자료 URL은 메모 후보이며 수집·확인은 별도로 진행하세요.",
                    );
                  })
                }
              >
                이 주제를 기획에 추가
              </button>
            </div>
          ))}
          {result.draft && (
            <>
              <h4>{result.draft.title}</h4>
              <pre className="codex-draft">{result.draft.body}</pre>
              <p className="preserve-lines">{result.draft.notes}</p>
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  run(async () => {
                    const r = await api.importCodexDraft(job.id);
                    onState(r.state);
                    onOpen(r.state.drafts.find((d) => d.id === r.draftId));
                    onNotice(
                      "Codex 결과를 새 원고로 가져왔습니다. 별도 검토와 사람 승인 후 발행하세요.",
                    );
                  })
                }
              >
                {job.importedDraftId
                  ? "가져온 원고 열기"
                  : "새 원고로 가져오기"}
              </button>
            </>
          )}
          {result.sourceUrls?.length > 0 && (
            <>
              <h4>참고 URL 후보</h4>
              <p className="hint">
                자동 수집·검증된 보관 자료가 아닙니다. 자료함에서 열람·수집해
                검토에 연결하세요.
              </p>
              <p className="source-url preserve-lines">
                {result.sourceUrls.join("\n")}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
