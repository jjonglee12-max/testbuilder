import React from "react";
export function DiffView({
  before,
  after,
  beforeTitle = "이전 내용",
  afterTitle = "현재 내용",
}) {
  const left = String(before || "").split("\n"),
    right = String(after || "").split("\n");
  return (
    <div className="diff-grid">
      <section>
        <h4>
          {beforeTitle} · {left.length}줄
        </h4>
        <pre>
          {left.map((line, i) => (
            <div className={line !== right[i] ? "diff-removed" : ""} key={i}>
              {line || " "}
            </div>
          ))}
        </pre>
      </section>
      <section>
        <h4>
          {afterTitle} · {right.length}줄
        </h4>
        <pre>
          {right.map((line, i) => (
            <div className={line !== left[i] ? "diff-added" : ""} key={i}>
              {line || " "}
            </div>
          ))}
        </pre>
      </section>
    </div>
  );
}
