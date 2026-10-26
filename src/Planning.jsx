import React, { useState } from "react";
import { Classification } from "./Classification";
const status = {
  idea: "기획",
  queued: "대기",
  running: "준비 중",
  ready: "사람 검토 대기",
  review_needed: "수정·중복 확인",
  failed: "실패",
  interrupted: "중단됨",
};
const stage = {
  collect: "자료 수집",
  write: "AI 초안",
  review: "별도 AI 검토",
  done: "준비 완료",
};
export function Planning({
  data,
  api,
  run,
  onState,
  onNotice,
  onOpen,
  busy,
  types,
}) {
  const initial = {
    topic: "",
    siteId: data.sites[0]?.id || "",
    type: types[0],
    notes: "",
    urls: "",
    sourceIds: [],
    categoryIds: [],
    tagIds: [],
    labels: [],
    targetDate: "",
    allowDuplicate: false,
  };
  const [form, setForm] = useState(initial),
    [selected, setSelected] = useState([]),
    [month, setMonth] = useState(
      new Date()
        .toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
        .slice(0, 7),
    ),
    [dateFilter, setDateFilter] = useState(""),
    [siteFilter, setSiteFilter] = useState("");
  const active = ["running", "stopping"].includes(data.batch?.status);
  const site = data.sites.find((s) => s.id === form.siteId);
  const plans = (data.plans || [])
    .filter(
      (p) =>
        (!siteFilter || p.siteId === siteFilter) &&
        (!dateFilter || p.targetDate === dateFilter),
    )
    .sort((a, b) =>
      (a.targetDate || "9999").localeCompare(b.targetDate || "9999"),
    );
  const [y, m] = month.split("-").map(Number);
  const days =
    Number.isFinite(y) && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 0;
  const offset = days ? new Date(Date.UTC(y, m - 1, 1)).getUTCDay() : 0;
  return (
    <>
      <section className="panel padded">
        <div className="section-heading">
          <div>
            <h3>주제 기획 · 콘텐츠 캘린더</h3>
            <p className="hint">
              날짜는 작성 계획입니다. 발행 예약이나 승인이 자동으로 만들어지지
              않습니다.
            </p>
          </div>
          <input
            aria-label="기획 달력 월"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="calendar">
          {["일", "월", "화", "수", "목", "금", "토"].map((v) => (
            <b key={v}>{v}</b>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={"empty" + i} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, "0")}`;
            const items = (data.plans || []).filter(
              (p) =>
                p.targetDate === date &&
                (!siteFilter || p.siteId === siteFilter),
            );
            return (
              <button
                key={date}
                className={dateFilter === date ? "selected" : ""}
                onClick={() => {
                  setDateFilter(date);
                  if (!form.id) setForm({ ...form, targetDate: date });
                }}
              >
                {i + 1}
                {items.length > 0 && <small>{items.length}개 기획</small>}
              </button>
            );
          })}
        </div>
        <div className="form-row">
          <label>
            기획 사이트 필터
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
            >
              <option value="">전체 사이트</option>
              {data.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className="text-button" onClick={() => setDateFilter("")}>
            {dateFilter ? `${dateFilter} 선택 해제` : "전체 날짜 표시"}
          </button>
        </div>
      </section>
      <div className="planning-grid">
        <section className="panel padded">
          <h3>{form.id ? "기획 수정" : "기획 등록"}</h3>
          <label>
            기획 사이트
            <select
              value={form.siteId}
              onChange={(e) =>
                setForm({
                  ...form,
                  siteId: e.target.value,
                  categoryIds: [],
                  tagIds: [],
                  labels: [],
                })
              }
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
            {form.id ? "주제" : "주제 목록 (줄마다 하나, 최대 20개)"}
            <textarea
              rows={4}
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              placeholder="AI 회의록 도구 선택 기준\nPDF 요약 AI 활용법"
            />
          </label>
          <label>
            기획 글 유형
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            작성 예정일 (발행 예약 아님)
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </label>
          <label>
            기획 참고 URL (최대 5개)
            <textarea
              rows={3}
              value={form.urls}
              onChange={(e) => setForm({ ...form, urls: e.target.value })}
              placeholder="공식 문서 URL을 줄마다 입력"
            />
          </label>
          <label>
            기획 메모 · 확인한 사실
            <textarea
              rows={4}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <details>
            <summary>
              기획에 연결할 보관 자료 ({form.sourceIds.length}/8)
            </summary>
            {(data.sources || []).map((s) => (
              <label className="checkbox" key={s.id}>
                <input
                  type="checkbox"
                  checked={form.sourceIds.includes(s.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sourceIds: e.target.checked
                        ? [...form.sourceIds, s.id]
                        : form.sourceIds.filter((id) => id !== s.id),
                    })
                  }
                />
                {s.title}
              </label>
            ))}
          </details>
          <Classification
            site={site}
            catalog={data.catalogs?.[form.siteId]}
            value={form}
            busy={busy || active}
            onChange={(v) =>
              setForm({
                ...form,
                categoryIds: v.categoryIds || [],
                tagIds: v.tagIds || [],
                labels: v.labels || [],
              })
            }
            onSync={() =>
              run(async () => {
                onState(await api.syncTaxonomy(form.siteId));
                onNotice("사이트 분류를 불러왔습니다.");
              })
            }
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.allowDuplicate}
              onChange={(e) =>
                setForm({ ...form, allowDuplicate: e.target.checked })
              }
            />
            기존 글과 유사한 주제 경고를 확인했으며 준비를 허용합니다.
          </label>
          <p className="hint">
            여러 주제를 등록하면 위 메모·자료·분류를 공통으로 사용합니다.
            주제별로 다르면 등록 후 각각 수정하세요.
          </p>
          <button
            className="primary"
            disabled={busy || !form.siteId || !form.topic.trim()}
            onClick={() =>
              run(async () => {
                const topics = form.id
                  ? [form.topic.trim()]
                  : [
                      ...new Set(
                        form.topic
                          .split("\n")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      ),
                    ];
                if (topics.length > 20)
                  throw Error("주제는 한 번에 최대 20개 등록하세요.");
                let result = data;
                const ids = [];
                for (const topic of topics) {
                  result = await api.savePlan({
                    ...form,
                    topic,
                    urls: form.urls.split(/\s+/).filter(Boolean),
                  });
                  const item =
                    result.plans.find((p) => p.id === form.id) ||
                    result.plans[0];
                  ids.push(item.id);
                  onState(result);
                }
                setSelected([...new Set([...selected, ...ids])]);
                setForm({
                  ...form,
                  id: undefined,
                  topic: "",
                  allowDuplicate: false,
                });
                onNotice(`${topics.length}개 기획을 저장했습니다.`);
              })
            }
          >
            기획 저장
          </button>
          {form.id && (
            <button className="secondary" onClick={() => setForm(initial)}>
              수정 취소
            </button>
          )}
        </section>
        <section className="panel padded">
          <h3>기획 목록 · 일괄 준비</h3>
          <p className="hint">
            한 번에 최대 20개를 순서대로 수집→작성→검토합니다. 앱이 실행
            중이어야 하며 AI 비용이 발생합니다. 이미지 준비·승인·발행은 직접
            진행합니다.
          </p>
          {data.batch && (
            <div className="batch-progress">
              <b>
                {{
                  running: "실행 중",
                  stopping: "현재 단계 완료 후 중지",
                  completed: "완료",
                  stopped: "중지됨",
                  interrupted: "앱 종료로 중단됨",
                }[data.batch.status] || data.batch.status}{" "}
                · {data.batch.done}/{data.batch.total}
              </b>
              {data.batch.currentId && (
                <p>
                  {data.plans.find((p) => p.id === data.batch.currentId)?.topic}{" "}
                  ·{" "}
                  {stage[
                    data.plans.find((p) => p.id === data.batch.currentId)?.stage
                  ] || "준비"}
                </p>
              )}
              {data.batch.error && <p>{data.batch.error}</p>}
            </div>
          )}
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy || active}
              onClick={() =>
                setSelected(
                  plans
                    .filter(
                      (p) =>
                        !["queued", "running"].includes(p.status) &&
                        (!p.draftId ||
                          data.drafts.find((d) => d.id === p.draftId)
                            ?.status === "draft"),
                    )
                    .slice(0, 20)
                    .map((p) => p.id),
                )
              }
            >
              준비 가능한 기획 선택
            </button>
            <button
              className="primary"
              disabled={busy || active || !selected.length}
              onClick={() =>
                run(async () => {
                  const ids = selected.filter((id) =>
                    data.plans.some((p) => p.id === id),
                  );
                  if (
                    !window.confirm(
                      `${ids.length}개 주제를 일괄 준비합니다. 주제당 최대 2회의 AI 생성·검토 요청과 자료 수집이 실행되며 API 사용료가 발생합니다. 승인·발행은 하지 않습니다. 시작할까요?`,
                    )
                  )
                    return;
                  onState(await api.startBatch({ planIds: ids }));
                  onNotice(
                    "일괄 준비를 시작했습니다. 현재 단계가 끝난 뒤 중지할 수 있습니다.",
                  );
                })
              }
            >
              선택한 주제 준비 ({selected.length})
            </button>
            <button
              className="secondary"
              disabled={busy || !active}
              onClick={() =>
                run(async () => {
                  onState(await api.stopBatch());
                  onNotice(
                    "이미 보낸 요청은 완료·과금될 수 있습니다. 현재 단계 이후 중지합니다.",
                  );
                })
              }
            >
              일괄 준비 중지
            </button>
          </div>
          {plans.map((p) => {
            const locked = ["queued", "running"].includes(p.status);
            return (
              <div className="plan-row" key={p.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    disabled={locked || active}
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <b>{p.topic}</b>
                </label>
                <small>
                  {data.sites.find((s) => s.id === p.siteId)?.name} ·{" "}
                  {p.targetDate || "날짜 미정"} · {status[p.status] || p.status}{" "}
                  {p.stage ? `· ${stage[p.stage] || p.stage}` : ""}
                </small>
                {p.error && <p className="hint">{p.error}</p>}
                {p.duplicates?.length > 0 && (
                  <p className="duplicate-warning">
                    유사 주제: {p.duplicates.map((v) => v.title).join(" / ")}
                  </p>
                )}
                <div className="button-row">
                  <button
                    className="text-button"
                    disabled={locked || busy}
                    onClick={() =>
                      setForm({ ...p, urls: (p.urls || []).join("\n") })
                    }
                  >
                    기획 수정
                  </button>
                  {p.draftId && (
                    <button
                      className="text-button"
                      disabled={locked || busy}
                      onClick={() => {
                        const d = data.drafts.find((d) => d.id === p.draftId);
                        if (d) onOpen(d);
                        else
                          onNotice(
                            "연결 원고가 삭제됐습니다. 기획 내용을 변경해 새로 준비하세요.",
                          );
                      }}
                    >
                      원고 열기
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={locked || busy}
                    onClick={() =>
                      run(async () => {
                        if (
                          !window.confirm(
                            "기획만 삭제합니다. 만들어진 원고는 보관합니다. 삭제할까요?",
                          )
                        )
                          return;
                        onState(await api.deletePlan(p.id));
                        setSelected(selected.filter((id) => id !== p.id));
                      })
                    }
                  >
                    기획 삭제
                  </button>
                </div>
              </div>
            );
          })}
          {!plans.length && (
            <div className="empty">
              <h3>아직 기획이 없습니다</h3>
              <p>주제를 등록하고 자료를 연결하세요.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
