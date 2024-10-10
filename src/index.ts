#!/usr/bin/env node
// Update all locale files from the source locale, using OPENAI

import { parseArgs } from "util";
import fs from "fs";
import OpenAI from "openai";
import { createRunner } from "./runner";
import { AITranslation } from "./types";
import { trimQuotes } from "./util";

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
let noTranslate: Array<string>;
let isQuiet: boolean;
let showHelp: boolean;

try {
  const args = parseArgs({
    options: {
      dir: { type: "string" },
      dest: { type: "string" },
      main: { type: "string" },
      openaitoken: { type: "string" },
      notranslate: { type: "string", multiple: true },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  }).values;

  dir = args.dir || "";

  // The destination folder is the same as the source locale folder
  // by default
  dest = args.dest || dir;
  mainLocale = args.main || "";
  openAIToken = trimQuotes(args.openaitoken || "").trim();

  noTranslate = args.notranslate || [];
  isQuiet = !!args.quiet;
  showHelp = !!args.help;
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

  if (!openAIToken) {
    console.error("--openaikey must be specified.");
    return false;
  }

  return true;
}

function printHelp() {
  console.log(`JSON AI Translation Help
Example usage
  json-ai-translation --dir public/locales --main en --openaitoken \"$OPENAI_API_KEY\"

Options
  --dir         [Required] The folder in which the locale files are stored
  --main        [Required] The primary locale code, e.g. --main en
  --openaitoken [Required] Your OpenAI token
  --dest        [Optional] The folder in which the translated locale files written. Defaults to the same as --dir
  --notranslate [Optional] A list of strings that should not be translated. For example, product names. E.g. --notranslate "My Cool App" "My Company Name"
  --quiet       [Optional] Do not log anything to the console when running
  --help        [Optional] Show this help information

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
