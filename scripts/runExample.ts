import { createRunner } from "../src/runner";
import { stringifyWithNewlines } from "../src/util";
import type { AITranslation } from "../src/types";

const simpleTranslation: AITranslation = (
  _prompt: string,
  jsonStr: string,
  locales: Array<string>
) => {
  const json = JSON.parse(jsonStr);

  const localeJsons = {};

  locales.forEach((locale) => {
    const localeJson = {};
    Object.keys(json).forEach((key) => {
      localeJson[key] = `[${locale.toUpperCase()}] ${json[key]}`;
    });
    localeJsons[locale] = localeJson;
  });

  return Promise.resolve(stringifyWithNewlines(localeJsons));
};

function makeRunner(folderName: string) {
  return createRunner({
    dest: `example/build/${folderName}`,
    dir: `example/${folderName}/locales`,
    isQuiet: false,
    mainLocale: "en",
    noTranslate: [],
    forceTranslateAll: true,

    translationFn: simpleTranslation,
  });
}

function nestedExample() {
  const runner = makeRunner("nested");

  runner.run();
}

// This should cause the example/build/new-locale/fr/common.json file
// to be created, even though there is just an empty "fr" folder as source
function newLocaleExample() {
  const runner = makeRunner("new-locale");

  runner.run();
}

function flatExample() {
  const runner = makeRunner("flat");

  runner.run();
}

function multifileExample() {
  const runner = makeRunner("multifile");

  runner.run();
}

multifileExample();
nestedExample();
flatExample();
newLocaleExample();
