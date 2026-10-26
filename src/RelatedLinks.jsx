import React, { useEffect, useState } from "react";
export function RelatedLinks({ draft, api, run, onChange, onNotice, busy }) {
  const [result, setResult] = useState(null);
  useEffect(() => setResult(null), [draft.siteId, draft.title, draft.topic]);
  const locked = [
    "published",
    "publishing",
    "uncertain",
    "queued",
    "remote_scheduled",
    "missed",
  ].includes(draft.status);
  return (
    <section className="panel side-card">
      <h3>내부 링크 · 중복 주제</h3>
      <p className="hint">
        같은 사이트에서 불러온 실제 발행 글과 제목·키워드를 비교합니다.
        검색량이나 의미 중복을 완전히 판별하는 기능은 아닙니다.
      </p>
      <button
        className="secondary full"
        disabled={busy || !draft.siteId}
        onClick={() =>
          run(async () => {
            setResult(await api.recommendLinks(draft));
          })
        }
      >
        내부 링크·유사 글 찾기
      </button>
      {result && (
        <>
          {result.duplicates.length > 0 && (
            <div className="duplicate-warning">
              비슷한 주제: {result.duplicates.map((p) => p.title).join(" / ")}
            </div>
          )}
          {result.links.map((p) => (
            <div className="related-post" key={p.id}>
              <b>{p.title}</b>
              <p className="source-url">{p.url}</p>
              <button
                className="text-button"
                disabled={busy || locked}
                onClick={() => {
                  if (p.siteId !== draft.siteId) {
                    onNotice("사이트를 다시 확인하세요.");
                    return;
                  }
                  if (draft.body.includes(p.url)) {
                    onNotice("본문에 이미 이 주소가 있습니다.");
                    return;
                  }
                  const title = p.title.replace(/[\[\]]/g, "");
                  const url = p.url.replace(/\(/g, "%28").replace(/\)/g, "%29");
                  const esc = (s) =>
                    String(s).replace(
                      /[&<>"']/g,
                      (c) =>
                        ({
                          "&": "&amp;",
                          "<": "&lt;",
                          ">": "&gt;",
                          '"': "&quot;",
                          "'": "&#39;",
                        })[c],
                    );
                  onChange(
                    draft.body +
                      (draft.format === "html"
                        ? `\n<p>관련 글: <a href="${esc(url)}">${esc(title)}</a></p>`
                        : `\n\n관련 글: [${title}](${url})`),
                  );
                }}
              >
                본문 끝에 내부 링크 넣기
              </button>
            </div>
          ))}
          {!result.links.length && (
            <p className="hint">
              관련 글 후보가 없습니다. 기존 글을 불러오거나 주제를 구체적으로
              입력하세요.
            </p>
          )}
        </>
      )}
    </section>
  );
}
