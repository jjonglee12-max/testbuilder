const { createHash } = require("node:crypto");
const { fingerprint } = require("./core.cjs");
function profile(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries({
    topic: "AI 도구와 업무 활용",
    audience: "한국 직장인·개인 창작자",
    tone: "차분하고 친절한 존댓말",
    category: "",
    instructions: "",
  })) {
    result[key] = String(value[key] ?? fallback)
      .trim()
      .slice(0, key === "instructions" ? 6000 : 500);
  }
  return result;
}
function evidence(d, sources) {
  return (d.sourceIds || [])
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean)
    .map(({ id, url, title, text, fetchedAt, contentHash, truncated }) => ({
      id,
      url,
      title,
      text,
      fetchedAt,
      contentHash,
      truncated,
    }));
}
function reviewHash(d, site, sources) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        draft: fingerprint({ ...d, publication: { mode: "now" } }, site),
        profile: profile(site?.profile),
        evidence: evidence(d, sources).map((s) => ({
          id: s.id,
          hash: s.contentHash,
        })),
      }),
    )
    .digest("hex");
}
function parseReview(value, sourceIds) {
  if (
    !value ||
    !["ready_for_human", "needs_changes"].includes(value.verdict) ||
    !Array.isArray(value.findings) ||
    !Array.isArray(value.claims) ||
    typeof value.summary !== "string"
  )
    throw Error("AI 검토 응답 형식이 올바르지 않습니다.");
  const findings = value.findings.slice(0, 40).map((v) => {
    if (
      !["blocker", "warning", "suggestion"].includes(v.severity) ||
      typeof v.message !== "string"
    )
      throw Error("AI 검토 지적 형식이 올바르지 않습니다.");
    return {
      severity: v.severity,
      message: v.message.slice(0, 2000),
      quote: String(v.quote || "").slice(0, 1000),
      fix: String(v.fix || "").slice(0, 2000),
    };
  });
  const claims = value.claims.slice(0, 50).map((v, i) => {
    if (
      typeof v.claim !== "string" ||
      !["supported", "unsupported", "uncertain"].includes(v.status)
    )
      throw Error("AI 사실 목록 형식이 올바르지 않습니다.");
    const ids = Array.isArray(v.sourceIds)
      ? v.sourceIds.filter((id) => sourceIds.includes(id))
      : [];
    return {
      id: `F${i + 1}`,
      claim: v.claim.slice(0, 1500),
      status: v.status === "supported" && !ids.length ? "uncertain" : v.status,
      sourceIds: ids,
      reason: String(v.reason || "").slice(0, 2000),
    };
  });
  return {
    verdict:
      findings.some((v) => v.severity === "blocker") ||
      claims.some((v) => v.status === "unsupported")
        ? "needs_changes"
        : value.verdict,
    summary: value.summary.slice(0, 3000),
    findings,
    claims,
  };
}
function checkReview(d, site, sources) {
  if (d.generation && !d.review)
    throw Error("AI 초안은 별도 AI 검토를 실행한 뒤 승인하세요.");
  if (!d.review) return;
  if (d.review.hash !== reviewHash(d, site, sources))
    throw Error(
      "원고·출처·운영 설정이 변경되었습니다. AI 검토를 다시 실행하세요.",
    );
  if (d.review.verdict === "needs_changes")
    throw Error("AI 검토의 수정 필요 항목을 해결한 뒤 다시 검토하세요.");
}
module.exports = { profile, evidence, reviewHash, parseReview, checkReview };
