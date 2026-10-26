import React, { useEffect, useState } from "react";
export function HTMLPreview({ body, api }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let live = true;
    api
      .previewHTML(body)
      .then((v) => {
        if (live) setPreview(v);
      })
      .catch(() => {
        if (live) setPreview("<p>미리보기를 만들지 못했습니다.</p>");
      });
    return () => {
      live = false;
    };
  }, [body]);
  return (
    <>
      <p className="hint">
        원문 HTML 미리보기입니다. 외부 이미지·스크립트·테마 CSS는 불러오지
        않습니다.
      </p>
      <iframe
        title="기존 글 HTML 미리보기"
        className="html-preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={preview}
      />
    </>
  );
}
export function UpdatePanel({
  draft,
  api,
  run,
  onState,
  onDraft,
  onOpen,
  onSave,
  onNotice,
  busy,
}) {
  const [instruction, setInstruction] = useState("");
  const locked = [
    "published",
    "updated",
    "publishing",
    "uncertain",
    "queued",
    "remote_scheduled",
    "missed",
  ].includes(draft.status);
  return (
    <section className="panel side-card">
      <h3>기존 글 수정 도우미</h3>
      <p className="hint">
        새 글이 아니라 아래 게시물을 수정합니다. 일반 HTML 구조를 유지하며
        스크립트·임베드 글은 지원하지 않습니다.
      </p>
      <p className="source-url">
        {draft.updateTarget.url}
        <br />
        게시물 ID {draft.updateTarget.remoteId}
      </p>
      <label>
        수정 요청
        <textarea
          rows={4}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="공식 자료에 맞춰 가격 설명만 수정하고 기존 문단·링크는 유지하세요."
        />
      </label>
      <button
        className="secondary full"
        disabled={busy || locked || !instruction.trim()}
        onClick={() =>
          run(async () => {
            if (
              !window.confirm(
                "현재 HTML 원고·참고 자료·수정 요청을 선택한 AI 엔진에 보내 수정안을 만듭니다. 해당 엔진의 이용량·비용이 발생하며 블로그에는 반영하지 않습니다. 진행할까요?",
              )
            )
              return;
            const d = await onSave();
            const next = await api.suggestPostUpdate({ id: d.id, instruction });
            onState(next);
            onDraft(next.drafts.find((v) => v.id === d.id));
            onNotice(
              "AI 수정안을 저장했습니다. 변경 비교와 별도 검토 후 승인하세요.",
            );
          })
        }
      >
        AI 수정안 만들기
      </button>
      {draft.updateNotes && <p className="review-note">{draft.updateNotes}</p>}
      <button
        className="text-button"
        disabled={busy}
        onClick={() =>
          run(async () => {
            if (
              !window.confirm(
                "현재 저장된 수정본은 보존하고 최신 원격 글로 새 수정본을 만듭니다. 진행할까요?",
              )
            )
              return;
            if (!locked) await onSave();
            const result = await api.openPostUpdate({
              siteId: draft.siteId,
              remoteId: draft.updateTarget.remoteId,
            });
            onState(result.state);
            onOpen(result.state.drafts.find((d) => d.id === result.draftId));
          })
        }
      >
        최신 원문으로 새 수정본 만들기
      </button>
      {["uncertain", "conflict", "updated"].includes(draft.status) && (
        <button
          className="secondary full"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = await api.checkPostUpdate(draft.id);
              onState(next);
              onDraft(next.drafts.find((d) => d.id === draft.id));
              onNotice("기존 글의 반영 상태를 조회했습니다.");
            })
          }
        >
          기존 글 수정 결과 조회
        </button>
      )}
      <p className="hint">
        반영 직전 원격본을 다시 비교합니다. 서버의 조건부 갱신 지원에 따라 극히
        짧은 동시 수정 경합까지 완전히 차단할 수는 없습니다.
      </p>
    </section>
  );
}
