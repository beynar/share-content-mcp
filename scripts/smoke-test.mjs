import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.TARGET_URL ?? "http://127.0.0.1:8787";
const apiKey = process.env.MCP_API_KEY;
const baseOrigin = new URL(baseUrl).origin;
const expectedPublicBaseUrl =
  process.env.EXPECTED_PUBLIC_BASE_URL ??
  (baseOrigin === "http://127.0.0.1:8787" || baseOrigin === "http://localhost:8787"
    ? baseOrigin
    : "https://share.beynar.dev");

if (!apiKey) {
  throw new Error("MCP_API_KEY is required.");
}

function buildMcpUrl(token) {
  const url = new URL("/mcp", baseUrl);
  if (token) {
    url.searchParams.set("apiKey", token);
  }

  return url;
}

function buildAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runNegativeHttpChecks() {
  const missingApiKeyResponse = await fetch(new URL("/mcp", baseUrl));
  assert.equal(missingApiKeyResponse.status, 401, "Missing token should return 401.");

  const wrongApiKeyResponse = await fetch(buildMcpUrl(), {
    headers: buildAuthHeaders(`${apiKey}-wrong`)
  });
  assert.equal(wrongApiKeyResponse.status, 401, "Wrong bearer token should return 401.");

  const wrongQueryApiKeyResponse = await fetch(buildMcpUrl(`${apiKey}-wrong`));
  assert.equal(wrongQueryApiKeyResponse.status, 401, "Wrong query token should return 401.");

  const unknownPageResponse = await fetch(new URL("/p/does-not-exist", baseUrl));
  assert.equal(unknownPageResponse.status, 404, "Unknown page should return 404.");
}

async function assertToolCatalog(client) {
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((tool) => tool.name);

  assert(toolNames.includes("share_content"), "share_content should be exposed.");
  assert(toolNames.includes("update_content"), "update_content should be exposed.");
  assert(toolNames.includes("search_pages"), "search_pages should be exposed.");
  assert(!toolNames.includes("share_html"), "share_html should not be exposed anymore.");
}

async function runModeChecks(mode) {
  const client = new Client({
    name: "html-storage-smoke-test",
    version: "0.2.0"
  });
  const transport =
    mode === "bearer"
      ? new StreamableHTTPClientTransport(buildMcpUrl(), {
          requestInit: {
            headers: buildAuthHeaders(apiKey)
          }
        })
      : new StreamableHTTPClientTransport(buildMcpUrl(apiKey));

  try {
    await client.connect(transport);
    await assertToolCatalog(client);

    const htmlMarker = `html-marker-${mode}-${Date.now()}`;
    const htmlTitle = `HTML Share ${mode} ${Date.now()}`;
    const htmlLabel = `html-${mode}`;
    const rawHtml = `<!doctype html><html><body><h1>${htmlMarker}</h1></body></html>`;
    const htmlResult = await client.callTool({
      arguments: { html: rawHtml, label: htmlLabel, title: htmlTitle },
      name: "share_content"
    });

    assert.equal(htmlResult.isError, undefined, "HTML share should succeed.");
    assert.equal(htmlResult.structuredContent?.format, "html", "HTML result should report format.");
    assert.equal(htmlResult.structuredContent?.title, htmlTitle, "HTML title should round-trip.");
    assert.equal(htmlResult.structuredContent?.label, htmlLabel, "HTML label should round-trip.");
    assert.match(
      htmlResult.structuredContent?.url ?? "",
      new RegExp(`^${escapeForRegExp(expectedPublicBaseUrl)}/p/`, "u"),
      "HTML result should use the expected public base URL."
    );

    const htmlPageResponse = await fetch(htmlResult.structuredContent.url);
    assert.equal(htmlPageResponse.status, 200, "Shared HTML should be served.");
    assert.equal(
      htmlPageResponse.headers.get("cache-control"),
      "public, max-age=0, must-revalidate",
      "Shared HTML should no longer be immutable."
    );
    assert.match(
      htmlPageResponse.headers.get("etag") ?? "",
      /^".+:\d+"$/u,
      "Shared HTML should include an ETag."
    );
    assert.match(
      htmlPageResponse.headers.get("last-modified") ?? "",
      /GMT/u,
      "Shared HTML should include Last-Modified."
    );
    assert.equal(
      htmlPageResponse.headers.get("content-type"),
      "text/html; charset=utf-8",
      "Shared HTML should be served as text/html."
    );
    const htmlPageHtml = await htmlPageResponse.text();
    assert.match(htmlPageHtml, new RegExp(htmlMarker, "u"), "HTML body content should still be present.");
    assert.match(
      htmlPageHtml,
      new RegExp(`<meta property="og:image" content="${escapeForRegExp(new URL(`/og/${htmlResult.structuredContent.id}.png`, expectedPublicBaseUrl).toString())}"`),
      "HTML page should include the OG image meta tag."
    );
    assert.match(
      htmlPageHtml,
      new RegExp(`<meta property="og:title" content="${escapeForRegExp(htmlTitle)}"`),
      "HTML page should include the OG title meta tag."
    );
    assert.match(
      htmlPageHtml,
      new RegExp(`<meta name="twitter:image" content="${escapeForRegExp(new URL(`/og/${htmlResult.structuredContent.id}.png`, expectedPublicBaseUrl).toString())}"`),
      "HTML page should include the Twitter image meta tag."
    );

    const htmlOgUrl = new URL(`/og/${htmlResult.structuredContent.id}.png`, expectedPublicBaseUrl).toString();
    const htmlOgResponse = await fetch(htmlOgUrl);
    assert.equal(htmlOgResponse.status, 200, "HTML OG image should be served.");
    assert.equal(htmlOgResponse.headers.get("content-type"), "image/png", "OG route should serve PNG.");
    assert.equal(
      htmlOgResponse.headers.get("cache-control"),
      "public, max-age=0, must-revalidate",
      "HTML OG image should no longer be immutable."
    );

    const markdownMarker = `markdown-marker-${mode}-${Date.now()}`;
    const markdownTitle = `Markdown Share ${mode} ${Date.now()}`;
    const markdownLabel = `markdown-${mode}`;
    const markdown = [
      `# ${markdownMarker}`,
      "",
      "Mermaid:",
      "",
      "```mermaid",
      "graph TD",
      "  A[Start] --> B[Ship]",
      "```",
      "",
      "Math: $E=mc^2$",
      "",
      "CJK: 你好，世界"
    ].join("\n");
    const markdownResult = await client.callTool({
      arguments: { label: markdownLabel, markdown, title: markdownTitle },
      name: "share_content"
    });

    assert.equal(markdownResult.isError, undefined, "Markdown share should succeed.");
    assert.equal(
      markdownResult.structuredContent?.format,
      "markdown",
      "Markdown result should report format."
    );
    assert.equal(
      markdownResult.structuredContent?.title,
      markdownTitle,
      "Markdown title should round-trip."
    );
    assert.equal(
      markdownResult.structuredContent?.label,
      markdownLabel,
      "Markdown label should round-trip."
    );
    assert.match(
      markdownResult.structuredContent?.url ?? "",
      new RegExp(`^${escapeForRegExp(expectedPublicBaseUrl)}/p/`, "u"),
      "Markdown result should use the expected public base URL."
    );

    const markdownPageResponse = await fetch(markdownResult.structuredContent.url);
    assert.equal(markdownPageResponse.status, 200, "Markdown page should be served.");
    assert.equal(
      markdownPageResponse.headers.get("cache-control"),
      "public, max-age=0, must-revalidate",
      "Markdown page should no longer be immutable."
    );
    const markdownPageHtml = await markdownPageResponse.text();
    assert.match(markdownPageHtml, new RegExp(markdownMarker, "u"), "Markdown heading should be present.");
    assert.match(
      markdownPageHtml,
      /id="markdown-share-data"/u,
      "Markdown page should include hydration bootstrap data."
    );
    assert.match(
      markdownPageHtml,
      /src="\/assets\/markdown-page\.js"/u,
      "Markdown page should include the markdown client bundle."
    );
    assert.match(
      markdownPageHtml,
      /href="\/assets\/markdown-page\.css"/u,
      "Markdown page should include the markdown stylesheet."
    );
    assert.match(markdownPageHtml, new RegExp(markdownTitle, "u"), "Markdown page title should be present.");
    const markdownOgUrl = new URL(
      `/og/${markdownResult.structuredContent.id}.png`,
      expectedPublicBaseUrl
    ).toString();
    assert.match(
      markdownPageHtml,
      new RegExp(`<meta property="og:image" content="${escapeForRegExp(markdownOgUrl)}"`),
      "Markdown page should include the OG image meta tag."
    );
    assert.match(
      markdownPageHtml,
      new RegExp(`<meta name="twitter:image" content="${escapeForRegExp(markdownOgUrl)}"`),
      "Markdown page should include the Twitter image meta tag."
    );
    assert.match(
      markdownPageHtml,
      new RegExp(`<meta property="og:title" content="${escapeForRegExp(markdownTitle)}"`),
      "Markdown page should include the OG title meta tag."
    );

    const markdownOgResponse = await fetch(markdownOgUrl);
    assert.equal(markdownOgResponse.status, 200, "Markdown OG image should be served.");
    assert.equal(
      markdownOgResponse.headers.get("content-type"),
      "image/png",
      "Markdown OG route should serve PNG."
    );
    assert.equal(
      markdownOgResponse.headers.get("cache-control"),
      "public, max-age=0, must-revalidate",
      "Markdown OG image should no longer be immutable."
    );

    const updatedHtmlMarker = `html-updated-${mode}-${Date.now()}`;
    const htmlUpdateResult = await client.callTool({
      arguments: {
        html: `<!doctype html><html><body><h1>${updatedHtmlMarker}</h1></body></html>`,
        id: htmlResult.structuredContent.id,
        title: `Updated HTML ${mode} ${Date.now()}`
      },
      name: "update_content"
    });
    assert.equal(htmlUpdateResult.isError, undefined, "HTML update should succeed.");
    assert.equal(
      htmlUpdateResult.structuredContent?.id,
      htmlResult.structuredContent.id,
      "HTML update should keep the same id."
    );
    assert.equal(
      htmlUpdateResult.structuredContent?.url,
      htmlResult.structuredContent.url,
      "HTML update should keep the same URL."
    );
    assert.equal(
      htmlUpdateResult.structuredContent?.label,
      htmlLabel,
      "HTML update should preserve label when omitted."
    );
    assert(
      (htmlUpdateResult.structuredContent?.updatedAt ?? 0) >= (htmlResult.structuredContent?.updatedAt ?? 0),
      "HTML update should advance updatedAt."
    );
    const updatedHtmlPageResponse = await fetch(htmlResult.structuredContent.url);
    const updatedHtmlPageBody = await updatedHtmlPageResponse.text();
    assert.match(updatedHtmlPageBody, new RegExp(updatedHtmlMarker, "u"), "Updated HTML body should be served.");
    assert.doesNotMatch(updatedHtmlPageBody, new RegExp(htmlMarker, "u"), "Old HTML body should not remain.");
    const htmlConditionalResponse = await fetch(htmlResult.structuredContent.url, {
      headers: {
        "If-None-Match": updatedHtmlPageResponse.headers.get("etag") ?? ""
      }
    });
    assert.equal(htmlConditionalResponse.status, 304, "HTML page should honor If-None-Match.");

    const updatedMarkdownMarker = `markdown-updated-${mode}-${Date.now()}`;
    const updatedMarkdownLabel = `updated-${mode}`;
    const markdownUpdateResult = await client.callTool({
      arguments: {
        id: markdownResult.structuredContent.id,
        label: updatedMarkdownLabel,
        markdown: `# ${updatedMarkdownMarker}\n\nUpdated markdown body.`,
        title: `Updated Markdown ${mode} ${Date.now()}`
      },
      name: "update_content"
    });
    assert.equal(markdownUpdateResult.isError, undefined, "Markdown update should succeed.");
    assert.equal(
      markdownUpdateResult.structuredContent?.id,
      markdownResult.structuredContent.id,
      "Markdown update should keep the same id."
    );
    assert.equal(
      markdownUpdateResult.structuredContent?.url,
      markdownResult.structuredContent.url,
      "Markdown update should keep the same URL."
    );
    assert.equal(
      markdownUpdateResult.structuredContent?.label,
      updatedMarkdownLabel,
      "Markdown update should replace the label when provided."
    );
    const updatedMarkdownResponse = await fetch(markdownResult.structuredContent.url);
    const updatedMarkdownPageHtml = await updatedMarkdownResponse.text();
    assert.match(
      updatedMarkdownPageHtml,
      new RegExp(updatedMarkdownMarker, "u"),
      "Updated markdown should be rendered."
    );
    assert.doesNotMatch(
      updatedMarkdownPageHtml,
      new RegExp(markdownMarker, "u"),
      "Old markdown content should not remain."
    );
    const updatedMarkdownOgResponse = await fetch(markdownOgUrl);
    assert.equal(updatedMarkdownOgResponse.status, 200, "Updated markdown OG image should still be served.");
    const markdownConditionalResponse = await fetch(markdownOgUrl, {
      headers: {
        "If-None-Match": updatedMarkdownOgResponse.headers.get("etag") ?? ""
      }
    });
    assert.equal(markdownConditionalResponse.status, 304, "OG image should honor If-None-Match.");

    const searchByLabelResult = await client.callTool({
      arguments: { query: updatedMarkdownLabel },
      name: "search_pages"
    });
    assert.equal(searchByLabelResult.isError, undefined, "Searching by label should succeed.");
    assert(
      searchByLabelResult.structuredContent?.pages?.some(
        (page) => page.id === markdownResult.structuredContent.id && page.label === updatedMarkdownLabel
      ),
      "Search should find the markdown page by label."
    );

    const searchByIdResult = await client.callTool({
      arguments: { query: htmlResult.structuredContent.id, limit: 5 },
      name: "search_pages"
    });
    assert.equal(searchByIdResult.isError, undefined, "Searching by id should succeed.");
    assert(
      searchByIdResult.structuredContent?.pages?.some(
        (page) =>
          page.id === htmlResult.structuredContent.id &&
          page.title === htmlUpdateResult.structuredContent?.title
      ),
      "Search should find the HTML page by id."
    );

    const bothResult = await client.callTool({
      arguments: {
        html: "<p>html</p>",
        markdown: "# markdown"
      },
      name: "share_content"
    });
    assert.equal(bothResult.isError, true, "Providing html and markdown together should fail.");

    const emptyResult = await client.callTool({
      arguments: {},
      name: "share_content"
    });
    assert.equal(emptyResult.isError, true, "Providing neither html nor markdown should fail.");

    const updateBothResult = await client.callTool({
      arguments: {
        html: "<p>html</p>",
        id: htmlResult.structuredContent.id,
        markdown: "# markdown"
      },
      name: "update_content"
    });
    assert.equal(updateBothResult.isError, true, "update_content should reject html and markdown together.");

    const updateEmptyResult = await client.callTool({
      arguments: { id: htmlResult.structuredContent.id },
      name: "update_content"
    });
    assert.equal(updateEmptyResult.isError, true, "update_content should reject missing content.");

    const updateMissingResult = await client.callTool({
      arguments: {
        html: "<p>missing</p>",
        id: "does-not-exist"
      },
      name: "update_content"
    });
    assert.equal(updateMissingResult.isError, true, "update_content should reject unknown ids.");

    const oversizedHtmlResult = await client.callTool({
      arguments: { html: "x".repeat(1024 * 1024 + 1) },
      name: "share_content"
    });
    assert.equal(oversizedHtmlResult.isError, true, "Oversized HTML should fail.");

    const oversizedMarkdownResult = await client.callTool({
      arguments: { markdown: "x".repeat(1024 * 1024 + 1) },
      name: "share_content"
    });
    assert.equal(oversizedMarkdownResult.isError, true, "Oversized markdown should fail.");

    const badLabelResult = await client.callTool({
      arguments: { html: "<p>bad</p>", label: "two words" },
      name: "share_content"
    });
    assert.equal(badLabelResult.isError, true, "Multi-word label should fail.");
  } finally {
    await transport.close();
    await client.close();
  }
}

await runNegativeHttpChecks();
await runModeChecks("bearer");
await runModeChecks("query");

console.log(`Smoke test passed against ${baseUrl}`);
