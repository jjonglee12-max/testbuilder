const crypto = require("node:crypto");
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function linkedText(text) {
  const parts = String(text).split(
    /(\[[^\]\n]{1,200}\]\(https:\/\/[^\s)<>]+\)|https?:\/\/[^\s<>]+)/g,
  );
  return parts
    .map((part, i) => {
      if (i % 2) {
        const markdown = part.match(
          /^\[([^\]\n]+)\]\((https:\/\/[^\s)<>]+)\)$/,
        );
        const target = markdown ? markdown[2] : part.replace(/[.,!?;:)]+$/, "");
        const suffix = markdown ? "" : part.slice(target.length);
        try {
          const u = httpsUrl(target);
          return `<a href="${escapeHtml(u.href)}" rel="noopener noreferrer">${escapeHtml(markdown ? markdown[1] : target)}</a>${escapeHtml(suffix)}`;
        } catch {}
      }
      return escapeHtml(part).replace(/\n/g, "<br>");
    })
    .join("");
}
function imageHtml(image) {
  const u = httpsUrl(image.url);
  return `<figure><img src="${escapeHtml(u.href)}" alt="${escapeHtml(image.alt)}" loading="lazy" style="max-width:100%;height:auto">${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}</figure>`;
}
function html(body, images = []) {
  const content = body
    .split(/\n\n+/)
    .filter(Boolean)
    .map((p) =>
      /^#{1,3} /.test(p)
        ? `<h2>${escapeHtml(p.replace(/^#{1,3} /, ""))}</h2>`
        : `<p>${linkedText(p)}</p>`,
    )
    .join("\n");
  return [
    ...images.filter((i) => i.position === "top").map(imageHtml),
    content,
    ...images
      .filter((i) => i.position !== "top" && i.position !== "featured_only")
      .map(imageHtml),
  ].join("\n");
}
function fingerprint(d, site) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        title: d.title,
        body: d.body,
        siteId: d.siteId,
        site: site && {
          type: site.type,
          url: site.url,
          blogId: site.blogId,
          username: site.username,
        },
        disclosure: d.disclosure,
        sources: d.sources || "",
        sourceIds: d.sourceIds || [],
        images: d.images || [],
        categoryIds: d.categoryIds || [],
        tagIds: d.tagIds || [],
        labels: d.labels || [],
        publication: d.publication || { mode: "now" },
        format: d.format || "markdown",
        updateTarget: d.updateTarget
          ? {
              remoteId: d.updateTarget.remoteId,
              siteId: d.updateTarget.siteId,
              siteKey: d.updateTarget.siteKey,
              hash: d.updateTarget.hash,
            }
          : undefined,
      }),
    )
    .digest("hex");
}
function issues(d) {
  const errors = [];
  if (!d.title?.trim()) errors.push("제목을 입력하세요.");
  if (!d.body?.trim()) errors.push("본문을 입력하세요.");
  if (!d.siteId) errors.push("발행 사이트를 선택하세요.");
  if (/확인 필요|TODO|\[미확인\]/i.test(d.body || ""))
    errors.push("본문의 미확인 항목을 해결하세요.");
  return errors;
}
function assertApproved(d, site) {
  if (!site) throw Error("사이트가 없습니다.");
  if (issues(d).length) throw Error(issues(d).join(" "));
  if (!d.approval || d.approval.hash !== fingerprint(d, site))
    throw Error("최종 원고를 다시 승인하세요.");
  if (
    d.status === "published" ||
    d.status === "updated" ||
    d.status === "publishing" ||
    ["uncertain", "queued", "remote_scheduled", "missed"].includes(d.status)
  )
    throw Error("발행되었거나 결과 확인이 필요한 원고입니다.");
}
function httpsUrl(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("인증정보를 포함하지 않은 HTTPS 주소를 입력하세요.");
  return u;
}
module.exports = {
  html,
  fingerprint,
  issues,
  assertApproved,
  httpsUrl,
  escapeHtml,
};
