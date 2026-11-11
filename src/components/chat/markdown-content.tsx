"use client";

/**
 * Markdown renderer for assistant messages. Inline [n] citation markers are
 * turned into clickable chips — but ONLY for indexes that exist in the
 * citation list, so the UI can never display a fabricated citation.
 */
import { Children, cloneElement, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { SourceRef } from "@/shared/types";
import { CitationChip } from "@/components/citations/citation-chip";

function injectCitations(node: ReactNode, citations: SourceRef[]): ReactNode {
  if (typeof node === "string") {
    const parts = node.split(/\[(\d{1,2})\]/g);
    if (parts.length === 1) return node;
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const index = Number(part);
        return isValidCitation(index, citations) ? <CitationChip key={`cite-${i}`} index={index} citations={citations} /> : null;
      }
      return part;
    });
  }
  if (Array.isArray(node)) {
    return Children.map(node, (child, i) => (
      <span key={`node-${i}`}>{injectCitations(child, citations)}</span>
    ));
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children) {
    return cloneElement(node, undefined, injectCitations(node.props.children, citations));
  }
  return node;
}

function isValidCitation(index: number, citations: SourceRef[]): boolean {
  return citations.some((c) => c.citationIndex === index);
}

interface MarkdownContentProps {
  content: string;
  citations: SourceRef[];
}

export const MarkdownContent = memo(function MarkdownContent({ content, citations }: MarkdownContentProps) {
  const withCitations = (children: ReactNode): ReactNode => injectCitations(children, citations);

  return (
    <div className="text-[15px] leading-relaxed text-foreground">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{withCitations(children)}</p>,
          ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1.5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1.5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{withCitations(children)}</li>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-primary/40 pl-3 text-muted-foreground italic">{children}</blockquote>
          ),
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                  {children}
                </code>
              );
            }
            return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
          },
          pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
