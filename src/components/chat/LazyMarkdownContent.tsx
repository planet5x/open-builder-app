import { lazy, Suspense } from "react";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

interface LazyMarkdownContentProps {
  content: string;
  variant: "user" | "assistant";
}

export function LazyMarkdownContent(props: LazyMarkdownContentProps) {
  return (
    <Suspense fallback={null}>
      <MarkdownContent {...props} />
    </Suspense>
  );
}
