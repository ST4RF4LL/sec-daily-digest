import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFetch, runSelect, runRender } from "../../src/pipeline/run";

describe("sec-digest e2e", () => {
  test("full pipeline with fixture data produces valid digest", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "sec-e2e-"));
    const outputPath = path.join(workspace, "digest.md");
    const opmlFixture = await readFile(path.join(process.cwd(), "tests/fixtures/tiny.opml"), "utf8");
    const feedFixture = await readFile(path.join(process.cwd(), "tests/fixtures/sample-rss.xml"), "utf8");

    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("CyberSecurityRSS/master/tiny.opml")) {
        return new Response(opmlFixture, { status: 200 });
      }
      if (url === "https://fixture.local/feed.xml") {
        return new Response(feedFixture, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const env = { SEC_DAILY_DIGEST_HOME: workspace } as NodeJS.ProcessEnv;
    const now = new Date("2026-02-27T12:00:00.000Z");

    // Stage 1: Fetch
    const fetchResult = await runFetch({
      env,
      fetcher,
      now,
    });
    expect(fetchResult.articles.length).toBe(2);

    // Stage 2: skip external scores (use rule fallback)

    // Stage 3: Select
    await runSelect({ env });

    // Stage 4: skip external summaries (use fallback)

    // Stage 5: Render
    const renderResult = await runRender({
      outputPath,
      env,
    });

    const markdown = await readFile(outputPath, "utf8");
    expect(renderResult.counters.articles).toBe(2);
    expect(renderResult.counters.selected).toBeGreaterThan(0);
    expect(markdown).toContain("今日趋势");
    expect(markdown).toContain("漏洞专报");
    expect(markdown).toContain("CVE-2026-77777");
    expect(markdown).toContain("fixture.local/post-1");

    await rm(workspace, { recursive: true, force: true });
  });
});
