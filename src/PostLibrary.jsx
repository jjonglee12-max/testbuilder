import React, { useState } from "react";
export function PostLibrary({
  data,
  api,
  run,
  onState,
  onNotice,
  busy,
  onOpen,
}) {
  const [siteId, setSiteId] = useState(data.sites[0]?.id || ""),
    [search, setSearch] = useState("");
  const site = data.sites.find((s) => s.id === siteId),
    catalog = data.catalogs?.[siteId];
  const posts = (data.posts || [])
    .filter(
      (p) =>
        p.siteId === siteId &&
        site?.catalogCurrent !== false &&
        p.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return (
    <section className="panel padded">
      <h3>기존 발행 글</h3>
      <p className="hint">
        공개된 글의 제목·주소·분류를 100개씩 불러옵니다. 원격 글과 로컬 원고를
        덮어쓰지 않습니다. 목록은 내부 링크와 중복 주제 확인에 활용됩니다.
      </p>
      <div className="form-row">
        <label>
          불러올 사이트
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">사이트 선택</option>
            {data.sites.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          제목 검색
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="도구명·주제"
          />
        </label>
      </div>
      <div className="button-row">
        <button
          className="primary"
          disabled={busy || !siteId}
          onClick={() =>
            run(async () => {
              const r = await api.syncPosts({ siteId, reset: true });
              onState(r.state);
              onNotice(
                `${r.count}개 불러왔습니다.${r.skipped.length ? " HTTPS 주소 형식이 맞지 않는 " + r.skipped.length + "개는 제외했습니다." : ""}`,
              );
            })
          }
        >
          처음부터 새로 불러오기
        </button>
        <button
          className="secondary"
          disabled={
            busy ||
            !siteId ||
            !catalog ||
            catalog.postsComplete ||
            site?.catalogCurrent === false
          }
          onClick={() =>
            run(async () => {
              const r = await api.syncPosts({ siteId });
              onState(r.state);
              onNotice(`${r.count}개를 추가로 불러왔습니다.`);
            })
          }
        >
          다음 100개 불러오기
        </button>
      </div>
      <p className="hint">
        {posts.length}개 표시 ·{" "}
        {catalog?.postsComplete
          ? "마지막 페이지까지 불러옴"
          : "아직 불러오지 않은 글이 있을 수 있습니다."}{" "}
        {catalog?.postsAt &&
          `최종 조회 ${new Date(catalog.postsAt).toLocaleString("ko-KR")}`}
      </p>
      {posts.map((p) => (
        <div className="imported-post" key={p.id}>
          <b>{p.title || "제목 없음"}</b>
          <p className="source-url">{p.url}</p>
          <small>
            {p.publishedAt
              ? new Date(p.publishedAt).toLocaleDateString("ko-KR")
              : ""}{" "}
            ·{" "}
            {p.labels?.join(", ") ||
              p.categoryIds
                ?.map(
                  (id) =>
                    catalog?.categories?.find((c) => c.id === id)?.name ||
                    `카테고리 #${id}`,
                )
                .join(", ")}
          </small>
          {p.excerpt && <p className="hint">{p.excerpt}</p>}
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.openPostUpdate({
                  siteId: p.siteId,
                  remoteId: p.remoteId,
                });
                onState(r.state);
                onOpen(r.state.drafts.find((d) => d.id === r.draftId));
                onNotice(
                  "원격 원문을 새 로컬 수정본으로 불러왔습니다. 아직 블로그는 바뀌지 않았습니다.",
                );
              })
            }
          >
            이 글 수정본 만들기
          </button>
        </div>
      ))}
      {!posts.length && (
        <div className="empty">
          <h3>불러온 글이 없습니다</h3>
          <p>사이트를 선택하고 글 목록을 불러오세요.</p>
        </div>
      )}
    </section>
  );
}
