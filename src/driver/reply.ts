import type { ParseResult } from "../vault/plan.js";

/** What the driver model decided after a failed check or a failed turn. */
export type DriverDecision =
  | { readonly action: "fix"; readonly prompt: string }
  | {
      readonly action: "escalate";
      readonly question: string;
      /** null when no safe default exists: the session pauses. */
      readonly defaultTaken: string | null;
      readonly reversible: boolean;
    };

export const DRIVER_REPLY_PROTOCOL = `Reply with one fenced \`json\` block and nothing else:

\`\`\`json
{"action": "fix", "prompt": "…"}
\`\`\`

or, to escalate:

\`\`\`json
{"action": "escalate", "question": "…", "default": "…", "reversible": true}
\`\`\``;

const MAX_PROMPT_CHARS = 2000;

/** Extracts the decision JSON (the last ```json block, or the whole reply) and validates it. */
export function parseDriverReply(text: string): ParseResult<DriverDecision> {
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const json = fences.at(-1)?.[1] ?? text.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, issues: ["the reply has no valid ```json block"] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: ["the JSON must be an object"] };
  }
  const fields = new Map(Object.entries(raw));
  const action = fields.get("action");

  if (action === "fix") {
    const prompt = fields.get("prompt");
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return { ok: false, issues: ['a "fix" needs a non-empty "prompt" string'] };
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return {
        ok: false,
        issues: [`"prompt" is ${prompt.length} characters; keep it under ${MAX_PROMPT_CHARS}`],
      };
    }
    return { ok: true, value: { action: "fix", prompt: prompt.trim() } };
  }

  if (action === "escalate") {
    const issues: string[] = [];
    const question = fields.get("question");
    if (typeof question !== "string" || question.trim() === "") {
      issues.push('an "escalate" needs a non-empty "question" string');
    }
    const defaultValue = fields.get("default") ?? null;
    if (defaultValue !== null && (typeof defaultValue !== "string" || defaultValue.trim() === "")) {
      issues.push('"default" must be a non-empty string or null');
    }
    const reversible = fields.get("reversible") ?? false;
    if (typeof reversible !== "boolean") {
      issues.push('"reversible" must be true or false');
    }
    if (
      issues.length > 0 ||
      typeof question !== "string" ||
      typeof reversible !== "boolean" ||
      (defaultValue !== null && typeof defaultValue !== "string")
    ) {
      return { ok: false, issues };
    }
    return {
      ok: true,
      value: {
        action: "escalate",
        question: question.trim(),
        defaultTaken: defaultValue === null ? null : defaultValue.trim(),
        reversible,
      },
    };
  }

  return { ok: false, issues: ['"action" must be "fix" or "escalate"'] };
}
