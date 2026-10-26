import React, { useEffect, useState } from "react";
export function Classification({
  site,
  catalog,
  value,
  onChange,
  onSync,
  busy,
}) {
  const [search, setSearch] = useState(""),
    [labelText, setLabelText] = useState((value.labels || []).join(", ")),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setLabelText((value.labels || []).join(", "));
  }, [(value.labels || []).join(","), focused, site?.id]);
  if (!site)
    return (
      <p className="hint">
        사이트를 선택하면 실제 발행 분류를 설정할 수 있습니다.
      </p>
    );
  const current = site.catalogCurrent !== false && catalog?.taxonomyAt;
  function toggle(key, id, checked) {
    onChange({
      ...value,
      [key]: checked
        ? [...(value[key] || []), id]
        : (value[key] || []).filter((v) => v !== id),
    });
  }
  return (
    <fieldset className="classification">
      <legend>실제 발행 분류</legend>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={onSync}
      >
        사이트 분류 불러오기
      </button>
      {site.type === "wordpress" ? (
        <>
          <p className="hint">
            선택하지 않으면 WordPress 기본 카테고리를 사용합니다. 새 분류는
            사이트 관리자에서 만드세요.
          </p>
          <input
            aria-label="분류 검색"
            placeholder="카테고리·태그 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {[
            ["categoryIds", "categories", "카테고리"],
            ["tagIds", "tags", "태그"],
          ].map(([key, items, label]) => (
            <details key={key}>
              <summary>
                {label} ({(value[key] || []).length}개 선택)
              </summary>
              <div className="taxonomy-list">
                {(current ? catalog[items] || [] : [])
                  .filter((v) =>
                    v.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((v) => (
                    <label className="checkbox" key={v.id}>
                      <input
                        type="checkbox"
                        checked={(value[key] || []).includes(v.id)}
                        disabled={busy}
                        onChange={(e) => toggle(key, v.id, e.target.checked)}
                      />
                      {v.name}
                    </label>
                  ))}
              </div>
            </details>
          ))}
          {!current && (
            <p className="hint">이 사이트의 분류 목록을 먼저 불러오세요.</p>
          )}
          {catalog?.taxonomyTruncated && (
            <p className="hint">각 분류는 최대 500개까지 불러왔습니다.</p>
          )}
        </>
      ) : (
        <>
          <label>
            Blogger 라벨 (쉼표로 구분)
            <input
              value={labelText}
              list={"labels-" + site.id}
              disabled={busy}
              placeholder="AI, 업무 자동화"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => {
                setLabelText(e.target.value);
                onChange({
                  ...value,
                  labels: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
          <datalist id={"labels-" + site.id}>
            {(catalog?.labels || []).slice(0, 250).map((v) => (
              <option value={v} key={v} />
            ))}
          </datalist>
          <p className="hint">
            새 라벨도 입력할 수 있습니다. 기존 라벨 제안은 불러온 게시물에서
            모읍니다.
          </p>
        </>
      )}
    </fieldset>
  );
}
