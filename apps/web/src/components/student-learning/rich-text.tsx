import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Renders teacher-written text safely: no HTML is ever injected. Supports paragraphs (blank line),
 * line breaks, "# " / "## " headings, "- " or "* " bullet lists, "1. " numbered lists, **bold**,
 * and bare http(s) links, which open in a new tab.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = toBlocks(text);
  return (
    <div className={cn("flex flex-col gap-3 text-sm leading-relaxed text-fg-secondary", className)}>
      {blocks.map((b, i) => {
        if (b.type === "h") {
          const Tag = b.level === 1 ? "h3" : "h4";
          return (
            <Tag key={i} className={cn("font-semibold text-fg", b.level === 1 ? "text-base" : "text-sm")}>
              {inline(b.lines[0])}
            </Tag>
          );
        }
        if (b.type === "ul" || b.type === "ol") {
          const List = b.type;
          return (
            <List key={i} className={cn("flex flex-col gap-1 ps-5", b.type === "ul" ? "list-disc" : "list-decimal")}>
              {b.lines.map((l, j) => (
                <li key={j}>{inline(l)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

type Block = { type: "p" | "ul" | "ol" | "h"; lines: string[]; level?: number };

const UL = /^\s*[-*]\s+/;
const OL = /^\s*\d+[.)]\s+/;
const H = /^(#{1,3})\s+/;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      cur = null;
      continue;
    }
    const h = H.exec(line);
    if (h) {
      blocks.push({ type: "h", level: h[1].length, lines: [line.slice(h[0].length)] });
      cur = null;
      continue;
    }
    const type: Block["type"] = UL.test(line) ? "ul" : OL.test(line) ? "ol" : "p";
    const content = type === "ul" ? line.replace(UL, "") : type === "ol" ? line.replace(OL, "") : line;
    if (cur && cur.type === type) cur.lines.push(content);
    else {
      cur = { type, lines: [content] };
      blocks.push(cur);
    }
  }
  return blocks;
}

const TOKEN = /(\*\*[^*]+\*\*|https?:\/\/[^\s<>"')\]]+)/g;

function inline(line: string): ReactNode[] {
  return line.split(TOKEN).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^https?:\/\//.test(part)) {
      const trimmed = part.replace(/[.,;:!?]+$/, "");
      const rest = part.slice(trimmed.length);
      return (
        <Fragment key={i}>
          <a href={trimmed} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-brand underline-offset-2 hover:underline">
            {trimmed}
          </a>
          {rest}
        </Fragment>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
