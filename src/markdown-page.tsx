import { Streamdown } from "streamdown";

import { markdownPlugins } from "./streamdown-plugins";

export const MARKDOWN_APP_ELEMENT_ID = "markdown-share-app";
export const MARKDOWN_BOOTSTRAP_ELEMENT_ID = "markdown-share-data";

export type MarkdownPagePayload = {
  markdown: string;
  title: string;
};

export function MarkdownPageApp({ markdown }: MarkdownPagePayload) {
  return (
    <div className="markdown-page min-h-screen bg-white text-[color:var(--foreground)]">
      <main className="markdown-page__main">
        <article className="markdown-page__article streamdown-shell">
          <Streamdown className="share-markdown" mode="static" plugins={markdownPlugins}>
            {markdown}
          </Streamdown>
        </article>
      </main>
    </div>
  );
}
