// A local process fixture. No model calls, network, or user credentials.
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli 0.163.0");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(
    "--ignore-user-config --ignore-rules --ephemeral --output-schema --output-last-message --json",
  );
  process.exit(0);
}
if (args[0] === "login") {
  console.error("Logged in using ChatGPT");
  process.exit(0);
}
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (b) => (raw += b));
process.stdin.on("end", () => {
  const emit = (e) => console.log(JSON.stringify(e));
  emit({ type: "thread.started", thread_id: "private-thread" });
  emit({ type: "turn.started" });
  if (raw.includes("HANG")) {
    setInterval(() => {}, 1000);
    return;
  }
  if (raw.includes("ERROR_AUTH")) {
    console.error("401 token expired PRIVATE_TOKEN_SHOULD_NOT_ESCAPE");
    process.exit(1);
  }
  if (raw.includes("FORBIDDEN_TOOL")) {
    emit({
      type: "item.started",
      item: { type: "command_execution", command: "DO_NOT_EXPOSE" },
    });
    setInterval(() => {}, 1000);
    return;
  }
  const schema = JSON.parse(
    fs.readFileSync(args[args.indexOf("--output-schema") + 1]),
  );
  let value = schema.properties.verdict
    ? {
        verdict: "ready_for_human",
        summary: "제공 자료 범위 검토",
        findings: [],
        claims: [],
      }
    : schema.properties.topics
      ? {
          summary: "작업 요약",
          topics: [
            {
              title: "AI 업무 안내",
              angle: "초보자용",
              sourceUrls: ["https://example.com/docs"],
            },
          ],
          draft: {
            title: "Codex 원고",
            body: "## 안내\n\n검토할 초안입니다.",
            notes: "사람 확인 필요",
          },
          sourceUrls: ["https://example.com/docs"],
          warnings: ["가격은 직접 확인하세요."],
        }
      : {
          title: "Codex 초안",
          body: "제공된 근거로 작성한 원고입니다.",
          notes: "검토 필요",
        };
  if (raw.includes("BAD_JSON"))
    value = { title: "응답 누락", approval: { hash: "forged" } };
  if (raw.includes("SEARCH_TEST"))
    emit({
      type: "item.completed",
      item: { type: "web_search", action: { query: "PRIVATE_QUERY" } },
    });
  const result = JSON.stringify(value);
  fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], result);
  emit({
    type: "item.completed",
    item: { type: "agent_message", text: result },
  });
  emit({
    type: "turn.completed",
    usage: { input_tokens: 120, output_tokens: 60 },
  });
});
