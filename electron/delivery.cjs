const { httpsUrl } = require("./core.cjs");
function publication(value = {}) {
  const mode = value.mode || "now";
  if (!["now", "remote", "local"].includes(mode))
    throw Error("발행 방식을 확인하세요.");
  if (mode === "now") return { mode };
  if (typeof value.at !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value.at))
    throw Error("시간대가 포함된 예약 일시를 입력하세요.");
  const at = new Date(value.at);
  if (!value.at || !Number.isFinite(at.getTime()))
    throw Error("올바른 예약 일시를 입력하세요.");
  return { mode, at: at.toISOString() };
}
function future(value, now = Date.now()) {
  const p = publication(value);
  if (p.mode === "now" || new Date(p.at).getTime() < now + 60000)
    throw Error("예약 시간은 현재보다 최소 1분 뒤여야 합니다.");
  return p;
}
function images(input = [], media = []) {
  if (!Array.isArray(input) || input.length > 10)
    throw Error("이미지는 최대 10개 넣을 수 있습니다.");
  if (input.filter((v) => v.featured).length > 1)
    throw Error("대표 이미지는 하나만 선택하세요.");
  const ids = new Set();
  return input.map((v) => {
    const id = String(v.id || "");
    if (!id || ids.has(id))
      throw Error("이미지 항목 ID가 없거나 중복됐습니다.");
    ids.add(id);
    const assetId = String(v.assetId || "");
    let url = "";
    if (assetId) {
      if (!media.some((m) => m.id === assetId))
        throw Error("보관한 이미지 파일을 찾을 수 없습니다.");
    } else {
      url = httpsUrl(String(v.url || "")).href;
    }
    if (v.featured && !assetId)
      throw Error("대표 이미지는 WordPress용 로컬 파일만 지정할 수 있습니다.");
    if (v.position === "featured_only" && !v.featured)
      throw Error("본문에 넣지 않을 이미지는 대표 이미지로 지정하세요.");
    const alt = String(v.alt || "")
      .trim()
      .slice(0, 500);
    if (!alt) throw Error("이미지 대체 텍스트를 입력하세요.");
    return {
      id,
      assetId,
      url,
      alt,
      caption: String(v.caption || "").slice(0, 1500),
      position: ["top", "featured_only"].includes(v.position)
        ? v.position
        : "bottom",
      featured: !!v.featured,
    };
  });
}
function imageFormat(buffer) {
  if (buffer.length < 12) throw Error("올바른 이미지 파일이 아닙니다.");
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: "image/png", ext: "png" };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  throw Error("PNG·JPEG·WebP 이미지 파일만 지원합니다.");
}
function due(drafts, now = Date.now()) {
  return drafts
    .filter(
      (d) => d.status === "queued" && Date.parse(d.publication?.at) <= now,
    )
    .map((d) => ({
      id: d.id,
      missed: now - Date.parse(d.publication.at) > 5 * 60000,
    }));
}
module.exports = { publication, future, images, imageFormat, due };
