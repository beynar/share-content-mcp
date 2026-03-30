import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";

const markdownMath = createMathPlugin({
  singleDollarTextMath: true
});

const markdownMermaid = createMermaidPlugin({
  config: {
    theme: "neutral"
  }
});

const markdownCode = createCodePlugin({
  themes: ["one-light", "github-dark"]
});

export const markdownPlugins = {
  cjk,
  code: markdownCode,
  math: markdownMath,
  mermaid: markdownMermaid
};
