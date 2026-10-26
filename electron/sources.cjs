const https = require("node:https");
const dns = require("node:dns/promises");
const net = require("node:net");
const { randomUUID, createHash } = require("node:crypto");
const cheerio = require("cheerio");
function isPublicAddress(value) {
  const ip = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIP(ip) === 6)
    return (
      /^2[0-9a-f]{3}:/.test(ip) &&
      !ip.startsWith("2001:db8:") &&
      !ip.startsWith("2002:")
    );
  return false;
}
function sourceURL(value) {
  let u;
  try {
    u = new URL(String(value).trim());
  } catch {
    throw Error("올바른 HTTPS 자료 URL을 입력하세요.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw Error("자료 URL은 인증정보 없는 HTTPS 기본 포트 주소여야 합니다.");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw Error("로컬·내부 주소는 수집할 수 없습니다.");
  u.hash = "";
  return u;
}
function extractPage(raw, url, mime = "text/html") {
  let title = url,
    text;
  if (mime.includes("text/plain")) text = raw;
  else {
    const $ = cheerio.load(raw);
    title =
      $("title").first().text().trim() || $("h1").first().text().trim() || url;
    $(
      'script,style,noscript,nav,footer,header,aside,form,iframe,svg,[hidden],[aria-hidden="true"]',
    ).remove();
    const node = $("article").first().length
      ? $("article").first()
      : $("main").first().length
        ? $("main").first()
        : $("body");
    node.find("p,h1,h2,h3,h4,li,tr,div,section,br").before("\n");
    text = node.text();
  }
  text = text
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  if (text.length < 80)
    throw Error(
      "읽을 수 있는 본문이 부족합니다. 로그인·자바스크립트 페이지는 직접 메모로 추가하세요.",
    );
  const truncated = text.length > 24000;
  text = text.slice(0, 24000);
  return {
    id: randomUUID(),
    url,
    title: title.slice(0, 300),
    text,
    fetchedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(text).digest("hex"),
    truncated,
  };
}
function download(url, address) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "AI-Blog-Studio/0.2 SourceCollector",
          Accept: "text/html,text/plain",
        },
        lookup: (_host, options, cb) =>
          cb(null, options.all ? [address] : address.address, address.family),
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          resolve({ redirect: res.headers.location });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error(`자료 수집 실패 (HTTP ${res.statusCode})`));
          return;
        }
        const mime = String(res.headers["content-type"] || "");
        if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(mime)) {
          res.resume();
          reject(Error("HTML 또는 텍스트 자료만 지원합니다."));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1500000) {
            res.destroy(Error("자료 크기가 1.5MB를 초과합니다."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({ raw: Buffer.concat(chunks).toString("utf8"), mime }),
        );
      },
    );
    req.setTimeout(15000, () =>
      req.destroy(Error("자료 수집 시간이 초과되었습니다.")),
    );
    const deadline = setTimeout(
      () => req.destroy(Error("자료 수집 시간이 초과되었습니다.")),
      20000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
  });
}
function createCollector({ lookup = dns.lookup, transport = download } = {}) {
  return async function collect(value) {
    let url = sourceURL(value);
    for (let hop = 0; hop < 5; hop++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      let addresses, timer;
      try {
        addresses = await Promise.race([
          lookup(hostname, { all: true }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error("DNS timeout")), 10000);
          }),
        ]);
      } catch {
        throw Error(
          "자료 주소의 DNS 조회에 실패했습니다. URL과 인터넷 연결을 확인하세요.",
        );
      } finally {
        clearTimeout(timer);
      }
      if (
        !addresses.length ||
        addresses.some((a) => !isPublicAddress(a.address))
      )
        throw Error("공개 인터넷 주소만 자료로 수집할 수 있습니다.");
      const result = await transport(url, addresses[0]);
      if (result.redirect) {
        url = sourceURL(new URL(result.redirect, url).href);
        continue;
      }
      return extractPage(result.raw, url.href, result.mime);
    }
    throw Error("자료 페이지의 이동 횟수가 너무 많습니다.");
  };
}
module.exports = {
  isPublicAddress,
  sourceURL,
  extractPage,
  createCollector,
  collectSource: createCollector(),
};
