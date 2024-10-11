#!/usr/bin/env node
// Update all locale files from the source locale, using OPENAI

import { parseArgs } from "util";
import fs from "fs";
import OpenAI from "openai";
import { createRunner, Runner } from "./runner";
import { AITranslation } from "./types";
import { trimQuotes } from "./util";
import Anthropic from "@anthropic-ai/sdk";

/*
  Steps:
    1 - Read all locale files
    2 - Flatten them all
    3 - Get a list of all values in the source file that have changed, using git
    4 - Translate all these values into all the required languages
    5 - Apply these changes to all the locales
    6 - Write the changes back to the files, nesting where appropriate.
*/

let dir: string;
let dest: string;
let mainLocale: string;
let openAIToken: string;
let anthropicAIToken: string;
let noTranslate: Array<string>;
let isQuiet: boolean;
let showHelp: boolean;
let forceTranslate: boolean;
let aiModelName: string;

try {
  const args = parseArgs({
    options: {
      dir: { type: "string" },
      dest: { type: "string" },
      main: { type: "string" },
      anthropicaitoken: { type: "string" },
      openaitoken: { type: "string" },
      aimodel: { type: "string" },
      notranslate: { type: "string", multiple: true },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      force: { type: "boolean" },
    },
  }).values;

  dir = args.dir || "";

  // The destination folder is the same as the source locale folder
  // by default
  dest = args.dest || dir;
  mainLocale = args.main || "";
  anthropicAIToken = trimQuotes(args.anthropicaitoken || "").trim();
  openAIToken = trimQuotes(args.openaitoken || "").trim();

  noTranslate = args.notranslate || [];
  isQuiet = !!args.quiet;
  showHelp = !!args.help;
  forceTranslate = !!args.force;
  aiModelName = args.aimodel || "";
} catch (err: any) {
  console.error("json-ai-translation error:", err.message);
  process.exit(1);
}

function validateArgs() {
  if (!dir) {
    console.error("--dir must be specified");
    return false;
  }

  if (!fs.existsSync(dir)) {
    console.error("--dir", dir, " does not exist");
    return false;
  }

  if (!mainLocale) {
    console.error("--main must specify the main locale to use, e.g. --main en");
    return false;
  }

  if (!openAIToken && !anthropicAIToken) {
    console.error(
      "One of --openaitoken or --anthropicaitoken must be specified."
    );
    return false;
  }

  return true;
}

function printHelp() {
  console.log(`JSON AI Translation Help
Example usage
  json-ai-translation --dir public/locales --main en --openaitoken \"$OPENAI_API_KEY\"

Options
  --dir              [Required] The folder in which the locale files are stored
  --main             [Required] The primary locale code, e.g. --main en
  --anthropicaitoken [Required] Your OpenAI token
  --openaitoken      [Required] Your OpenAI token
  --dest             [Optional] The folder in which the translated locale files written. Defaults to the same as --dir
  --notranslate      [Optional] A list of strings that should not be translated. For example, product names. E.g. --notranslate "My Cool App" "My Company Name"
  --quiet            [Optional] Do not log anything to the console when running
  --force            [Optional] Force the translation of the entire main locale file, not just the changed items
  --help             [Optional] Show this help information

  Read more at https://www.npmjs.com/package/json-ai-translation
`);
}

if (showHelp) {
  printHelp();
  process.exit(0);
}

if (!validateArgs()) {
  process.exit(0);
}

let openai: OpenAI;
let anthropic: Anthropic;

const translationFn: AITranslation = async (prompt: string, json: string) => {
  const completePrompt = prompt + `\n${json}`;
  if (openAIToken) {
    openai =
      openai ||
      new OpenAI({
        apiKey: openAIToken,
      });
    const response = await openai.chat.completions.create({
      model: aiModelName || "gpt-4o",
      messages: [{ role: "user", content: completePrompt }],
    });

    let messageContent = response.choices[0].message.content;

    return messageContent || "";
  } else if (anthropicAIToken) {
    anthropic =
      anthropic ||
      new Anthropic({
        apiKey: anthropicAIToken,
      });

    const message = await anthropic.messages.create({
      max_tokens: 8192,
      messages: [{ role: "user", content: completePrompt }],
      model: aiModelName || "claude-3-5-sonnet-20240620",
    });

    let messageContent = "";
    const firstContent = message.content[0];
    if (firstContent.type === "text") {
      messageContent = firstContent.text;
    }
    return messageContent;
  } else {
    // It should not be possible to get here
    throw new Error(
      "One of --openaitoken or --anthropicaitoken must be specified."
    );
  }
};

async function exec() {
  const runner: Runner = createRunner({
    dest,
    dir,
    isQuiet,
    mainLocale,
    noTranslate,
    translationFn,
    forceTranslateAll: forceTranslate,
  });

  return runner.run().then((result) => {
    const [totalKeyModified, totalKeyDeleted, totalKeyNewCount] = result || [];
    runner.log(
      "Completed updating i18n resources. ",
      totalKeyModified,
      " keys updated, ",
      totalKeyDeleted,
      " keys deleted",
      totalKeyNewCount,
      " new keys added"
    );
  });
}

exec();
