import React, { useEffect, useState } from "react";
import { DiffView } from "./DiffView";
export function BackupPage({ data, api, run, onState, onNotice, busy }) {
  const [list, setList] = useState([]),
    [chosen, setChosen] = useState(null),
    [settings, setSettings] = useState(false);
  async function refresh() {
    setList(await api.listBackups());
  }
  useEffect(() => {
    refresh().catch((e) => onNotice(e.message));
  }, []);
  async function restore(path) {
    if (
      !window.confirm(
        "현재 원고와 발행 기록은 유지하고 복구본을 추가합니다. 승인·유료 작업·로컬 예약은 자동 재개하지 않습니다. 플랫폼 예약은 취소되지 않습니다. 복구할까요?",
      )
    )
      return;
    const result = await api.restoreBackup({ path, settings });
    onState(result.state);
    onNotice(
      `복구 완료 · ${result.restoredDrafts}개 원고를 확인하세요. API 키와 사이트 비밀번호는 백업에 포함하지 않습니다.`,
    );
    await refresh();
  }
  return (
    <section className="panel padded">
      <h3>백업 · 복원</h3>
      <p className="hint">
        먼저 원고를 저장하세요. 백업은 manifest.json·state.json과 이미지·이력이
        든 폴더입니다. API 키·사이트 비밀번호를 제외하지만 원고·자료·사진은
        평문이므로 개인 보관 폴더를 사용하세요. 복구는 현재 데이터를 덮어쓰지
        않고 복구본을 추가합니다.
      </p>
      {data.recovery && (
        <div className="notice">
          {data.recovery.message} 보존 파일: {data.recovery.file}
        </div>
      )}
      {data.backupStatus?.error && (
        <div className="notice">자동 백업 오류: {data.backupStatus.error}</div>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.createBackup({});
              onNotice("백업 생성: " + r.path);
              await refresh();
            })
          }
        >
          지금 로컬 백업
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.createBackup({ external: true });
              if (!r.cancelled) onNotice("내보낸 백업 폴더: " + r.path);
            })
          }
        >
          외부 폴더에 백업
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.chooseBackup();
              if (!r.cancelled) setChosen(r);
            })
          }
        >
          복구할 백업 폴더 선택
        </button>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings}
          onChange={(e) => setSettings(e.target.checked)}
        />
        편집 프롬프트·워크스페이스 이름·AI 주소와 모델도 복구 (키 제외)
      </label>
      <p className="hint">
        로컬 예약·일괄 준비·발행 처리 중에는 먼저 중지하세요. 기존 PC에서 같은
        사이트 연결은 유지하고, 새 PC에서는 인증정보를 다시 입력해야 합니다.
        매일 첫 실행 시 자동 백업하며 자동 백업 폴더에는 최근 10개를 유지합니다.
      </p>
      {chosen && (
        <div className="backup-row">
          <b>선택한 외부 백업</b>
          <p>
            {chosen.createdAt} · 원고 {chosen.drafts}개
          </p>
          <p className="source-url">{chosen.path}</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run(() => restore(chosen.path))}
          >
            선택한 백업 복구
          </button>
        </div>
      )}
      {list.map((b) => (
        <div className="backup-row" key={b.id}>
          <b>
            {new Date(b.createdAt).toLocaleString("ko-KR")} ·{" "}
            {{
              daily: "자동 백업",
              manual: "수동 백업",
              "before-update": "기존 글 수정 전",
              "before-restore": "복구 전",
            }[b.reason] || b.reason}
          </b>
          <p className="source-url">{b.path}</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run(() => restore(b.path))}
          >
            이 백업 복구
          </button>
        </div>
      ))}
    </section>
  );
}
export function HistoryPanel({
  draft,
  data,
  api,
  run,
  onState,
  onOpen,
  onNotice,
  busy,
}) {
  const [selected, setSelected] = useState(null);
  const rows = (data.revisions || []).filter(
    (r) => !draft?.id || r.draftId === draft.id,
  );
  useEffect(() => setSelected(null), [draft?.id]);
  return (
    <section className="history-panel">
      <h3>원고 변경 이력</h3>
      <p className="hint">
        저장한 버전을 비교·복원합니다. 원고별 최근 20개, 전체 최근 500개를
        보관합니다. 복원하면 승인·검토를 다시 확인해야 하며 블로그가 즉시
        바뀌지는 않습니다.
      </p>
      <div className="revision-list">
        {rows.map((r) => (
          <button
            className="secondary"
            key={r.id}
            disabled={busy}
            onClick={() =>
              run(async () => setSelected(await api.readRevision(r.id)))
            }
          >
            {new Date(r.at).toLocaleString("ko-KR")} · {r.reason} · {r.title}
          </button>
        ))}
      </div>
      {!rows.length && (
        <p className="hint">저장된 이력이 없습니다. 원고 저장 후 확인하세요.</p>
      )}
      {selected && (
        <>
          <DiffView
            before={selected.snapshot.body}
            after={draft?.body || ""}
            beforeTitle={selected.snapshot.title || "이전 원고"}
            afterTitle={draft?.title || "현재 원고"}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    "현재 저장된 원고는 보존하고 선택한 이력을 로컬에서 복원합니다. 기존 글 수정본은 최신 원격본을 읽어 새 수정본으로 준비합니다. 블로그에는 바로 반영하지 않습니다. 진행할까요?",
                  )
                )
                  return;
                const r = await api.restoreRevision(selected.id);
                onState(r.state);
                onOpen(r.state.drafts.find((d) => d.id === r.draftId));
                onNotice(
                  "원고를 복원했습니다. 내용과 대상 사이트를 다시 확인하세요.",
                );
              })
            }
          >
            이 버전으로 로컬 복원
          </button>
        </>
      )}
    </section>
  );
}
