#!/usr/bin/env node
// Update all locale files from the source locale, using OPENAI

import { parseArgs } from "util";
import fs from "fs";
import OpenAI from "openai";
import { createRunner } from "./runner";
import { AITranslation } from "./types";

/*
  Steps:
    1 - Read all locale files
    2 - Flatten them all
    3 - Get a list of all values in the source file that have changed, using git
    4 - Translate all these values into all the required languages
    5 - Apply these changes to all the locales
    6 - Write the changes back to the files, nesting where appropriate.
*/

const args = parseArgs({
  options: {
    dir: { type: "string" },
    dest: { type: "string" },
    main: { type: "string" },
    openaitoken: { type: "string" },
    notranslate: { type: "string", multiple: true },
    quiet: { type: "boolean" },
  },
}).values;

const dir = args.dir || "";

// The destination folder is the same as the source locale folder
// by default
const dest = args.dest || dir;
const mainLocale = args.main || "";
const openAIToken = args.openaitoken || "";
const noTranslate = args.notranslate || [];
const isQuiet = !!args.quiet;

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

  if (!openAIToken) {
    console.error("--openaikey must be specified.");
    return false;
  }

  return true;
}

if (!validateArgs()) {
  process.exit(0);
}

const openai = new OpenAI({
  apiKey: openAIToken,
});

const translationFn: AITranslation = async (prompt: string, json: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt + `\n${json}` }],
  });

  let messageContent = response.choices[0].message.content;

  return messageContent || "";
};

const runner = createRunner({
  dest,
  dir,
  isQuiet,
  mainLocale,
  noTranslate,
  translationFn,
});

async function exec() {
  // Read the locale codes

  return runner.run();
}

exec().then((result) => {
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
