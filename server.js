const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const aiBaseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const aiApiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY;
const aiModel = process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || "deepseek-v4-flash";
const apiTimeoutMs = 20000;

app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(express.static("public"));

function makeResponse({ readyPrompt = "", optionalInfo = [], result = "" } = {}) {
  return {
    readyPrompt: typeof readyPrompt === "string" ? readyPrompt : "",
    optionalInfo: Array.isArray(optionalInfo) ? optionalInfo : [],
    result: typeof result === "string" ? result : "",
  };
}

function buildFallbackAnswer(input, supplement = "") {
  const supplementSection = supplement ? `\n\n补充信息：\n- ${supplement}` : "";

  return {
    readyPrompt: `角色：
你是一个专业、耐心、表达清晰的 AI 助手。

目标：
请根据我的需求，生成一个清楚、可直接使用的结果。

我的需求：
- ${input}${supplementSection}

要求：
- 如果信息不完整，请先基于常见情况做合理假设，不要直接中断
- 内容要清楚、实用、自然
- 如果适合，请给出 2-3 个版本供我选择
- 如果仍有不确定信息，请在最后列出可以补充的内容

输出格式：
- 先给出最终内容
- 再给出简短说明或可选补充项`,
    optionalInfo: ["使用对象或场景", "希望的语气和长度", "有没有必须包含或避免的内容"],
  };
}

function buildUserInstruction(input, supplement, hideOptionalInfo) {
  const optionalRule = hideOptionalInfo
    ? "5. optionalInfo 必须返回空数组。用户已经看过补充建议，本次是在重新整理，不要继续给新的补充建议。"
    : "5. optionalInfo 只列真正有助于结果更准确的信息，最多 4 条。";
  const supplementText = supplement ? `\n\n用户补充信息：\n${supplement}` : "";

  return `请把下面这句普通用户的话，整理成一段可以直接复制到 ChatGPT、豆包、DeepSeek、Kimi 等 AI 工具里使用的专业问法。

用户原话：
${input}${supplementText}

请严格按 JSON 返回，不要输出 Markdown 代码块，不要解释过程：
{
  "readyPrompt": "可以直接复制使用的专业问法",
  "optionalInfo": ["想让结果更准确，可以补充的信息1", "想让结果更准确，可以补充的信息2"]
}

写作要求：
1. 用户输入再简单，也必须先生成 readyPrompt，不要卡住用户。
2. 如果信息不足，请用合理默认假设补足，让这段问法仍然可用。
3. readyPrompt 要写成 AI 容易理解和执行的专业格式，可以使用“角色、目标、已知信息、要求、输出格式”等清晰分区。
4. readyPrompt 必须排版清楚，标题独立成行，列表一行一条，不要挤成一整段。
${optionalRule}
6. 对改写类需求，要提醒用户把原文粘贴进去。
7. 对计划类需求，可以在问法里加入默认假设，同时在 optionalInfo 里提示目的地、天数、预算、同行人、节奏偏好等。
8. 对事实、价格、政策、医疗、法律、投资等可能变化或需要专业判断的问题，要在 readyPrompt 里请 AI 说明不确定之处，并建议必要时核实或咨询专业人士。
9. 不要编造具体姓名、日期、地点、价格、机构等事实信息；如果用户没提供，请使用【待补充】或“可先按常见情况处理”。
10. readyPrompt 可以专业，但不要堆砌术语；要让普通人复制后也知道大概在问什么。`;
}

function cleanJsonText(text) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseAiAnswer(content, input, supplement) {
  try {
    const parsed = JSON.parse(cleanJsonText(content));
    const fallback = buildFallbackAnswer(input, supplement);
    const readyPrompt =
      typeof parsed.readyPrompt === "string" && parsed.readyPrompt.trim()
        ? parsed.readyPrompt.trim()
        : fallback.readyPrompt;
    const optionalInfo = Array.isArray(parsed.optionalInfo)
      ? parsed.optionalInfo.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()).slice(0, 4)
      : [];

    return { readyPrompt, optionalInfo };
  } catch (error) {
    console.warn("AI JSON parse failed, using fallback response:", {
      message: error.message,
      rawLength: typeof content === "string" ? content.length : 0,
    });

    return {
      readyPrompt: content.trim() || buildFallbackAnswer(input, supplement).readyPrompt,
      optionalInfo: buildFallbackAnswer(input, supplement).optionalInfo,
    };
  }
}

async function organizeQuestion(input, supplement = "", hideOptionalInfo = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);

  try {
    const response = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: aiModel,
        messages: [
          {
            role: "system",
            content:
              "你是一个 AI 问法整理助手。界面服务对象是普通用户，但你生成的 readyPrompt 应该是 AI 更容易理解和执行的专业问法：结构清晰、指令明确、格式可复制。",
          },
          {
            role: "user",
            content: buildUserInstruction(input, supplement, hideOptionalInfo),
          },
        ],
        temperature: 0.35,
        stream: false,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || `AI 服务返回异常，状态码：${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = data?.error?.code;
      console.error("AI service returned an error:", {
        status: response.status,
        code: error.code,
      });
      throw error;
    }

    const content = data?.choices?.[0]?.message?.content?.trim();
    const answer = content ? parseAiAnswer(content, input, supplement) : buildFallbackAnswer(input, supplement);

    if (hideOptionalInfo) {
      answer.optionalInfo = [];
    }

    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

app.post("/run", async (req, res) => {
  try {
    const { input, supplement, hideOptionalInfo } = req.body || {};
    const trimmedInput = typeof input === "string" ? input.trim() : "";
    const trimmedSupplement = typeof supplement === "string" ? supplement.trim() : "";

    console.log("Received /run request:", {
      inputLength: trimmedInput.length,
      supplementLength: trimmedSupplement.length,
      hideOptionalInfo: Boolean(hideOptionalInfo),
    });

    if (!trimmedInput) {
      return res.status(400).json(makeResponse({ result: "请输入一句你想让AI帮你做什么" }));
    }

    if (trimmedInput.length > 2000) {
      return res.status(400).json(makeResponse({ result: "输入内容过长，请控制在2000字以内" }));
    }

    if (!aiApiKey) {
      return res.status(500).json(makeResponse({ result: "AI服务暂时不可用，请稍后再试" }));
    }

    const answer = await organizeQuestion(trimmedInput, trimmedSupplement, Boolean(hideOptionalInfo));

    return res.json(
      makeResponse({
        readyPrompt: answer.readyPrompt,
        optionalInfo: answer.optionalInfo,
        result: answer.readyPrompt,
      })
    );
  } catch (error) {
    const isTimeout = error.name === "AbortError";
    const isNetworkError = error.message === "fetch failed" || error.cause;

    console.error("Question organization failed:", {
      status: error.status,
      code: error.code,
      name: error.name,
      message: error.message,
    });

    if (isTimeout) {
      return res.status(504).json(makeResponse({ result: "AI服务响应超时，请稍后再试" }));
    }

    if (isNetworkError) {
      return res.status(503).json(makeResponse({ result: "AI服务暂时不可用，请稍后再试" }));
    }

    return res.status(500).json(makeResponse({ result: "整理失败了，请稍后再试" }));
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    console.error("Invalid JSON request body:", {
      message: error.message,
    });

    return res.status(400).json(makeResponse({ result: "请求格式不正确，请稍后再试" }));
  }

  next(error);
});

app.use((req, res) => {
  res.status(404).json(makeResponse({ result: "页面不存在" }));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
  console.log(`AI question organizer model: ${aiModel}`);
});
