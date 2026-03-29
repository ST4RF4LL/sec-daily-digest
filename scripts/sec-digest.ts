#!/usr/bin/env bun

import process from "node:process";
import { runFetch, runSelect, runRender } from "../src/pipeline/run";

function printUsage(): never {
  console.log(`sec-daily-digest — multi-stage cybersecurity digest generator

Usage:
  bun scripts/sec-digest.ts <command> [options]

Commands:
  fetch     Fetch RSS + Twitter data, dedup, filter → staging/fetched.json
  select    Apply AI scores, pick top-N → staging/selected.json
  render    Apply summaries, render Markdown digest

Fetch options:
  --opml <tiny|full>     OPML profile (default: tiny)
  --hours <n>            Time range in hours (default: 48)
  --mode <daily|weekly>  Shortcut: daily=48h, weekly=168h
  --enrich               Fetch full text for articles
  --no-twitter           Disable Twitter/X KOL fetching

Select options:
  --top-n <n>            Number of selected items (default: 20)

Render options:
  --output <path>        Output markdown path
  --highlights <text>    Trend summary text (from calling LLM)
  --highlights-file <p>  Read highlights from file instead
  --email <addr>         Send digest via gog to this address

  --help                 Show help
`);
  process.exit(0);
}

interface ParsedArgs {
  command: string;
  opmlProfile?: "tiny" | "full";
  hours?: number;
  topN?: number;
  outputPath?: string;
  twitterEnabled?: boolean;
  emailTo?: string;
  enrich?: boolean;
  highlights?: string;
  highlightsFile?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const options: ParsedArgs = { command };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--opml" && argv[i + 1]) {
      const val = argv[i + 1]!;
      if (val === "tiny" || val === "full") {
        options.opmlProfile = val;
      }
      i += 1;
    } else if (arg === "--hours" && argv[i + 1]) {
      options.hours = Number.parseInt(argv[i + 1]!, 10);
      i += 1;
    } else if (arg === "--mode" && argv[i + 1]) {
      const mode = argv[i + 1]!;
      if (mode === "weekly") {
        options.hours = 168;
      } else if (mode === "daily") {
        options.hours = 48;
      }
      i += 1;
    } else if (arg === "--top-n" && argv[i + 1]) {
      options.topN = Number.parseInt(argv[i + 1]!, 10);
      i += 1;
    } else if (arg === "--output" && argv[i + 1]) {
      options.outputPath = argv[i + 1]!;
      i += 1;
    } else if (arg === "--no-twitter") {
      options.twitterEnabled = false;
    } else if (arg === "--email" && argv[i + 1]) {
      options.emailTo = argv[i + 1]!;
      i += 1;
    } else if (arg === "--enrich") {
      options.enrich = true;
    } else if (arg === "--highlights" && argv[i + 1]) {
      options.highlights = argv[i + 1]!;
      i += 1;
    } else if (arg === "--highlights-file" && argv[i + 1]) {
      options.highlightsFile = argv[i + 1]!;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
    }
  }

  return options;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "fetch": {
      await runFetch({
        opmlProfile: args.opmlProfile,
        hours: args.hours,
        enrich: args.enrich,
        twitterEnabled: args.twitterEnabled,
      });
      break;
    }

    case "select": {
      await runSelect({
        topN: args.topN,
      });
      break;
    }

    case "render": {
      let highlights = args.highlights;
      if (!highlights && args.highlightsFile) {
        const { readFile } = await import("node:fs/promises");
        highlights = await readFile(args.highlightsFile, "utf8");
      }

      const result = await runRender({
        outputPath: args.outputPath,
        highlights,
        emailTo: args.emailTo,
      });

      console.log(
        `[sec-digest] stats feeds=${result.counters.feeds} articles=${result.counters.articles} recent=${result.counters.recent} selected=${result.counters.selected} vuln_events=${result.counters.vulnerabilities} twitter_kols=${result.counters.twitter_kols}`,
      );
      break;
    }

    case "help":
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${args.command}. Use --help for usage.`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[sec-digest] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
