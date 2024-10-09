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

function nestedExample() {
  const runner = createRunner({
    dest: "example/build/nested",
    dir: "example/nested/locales",
    isQuiet: false,
    mainLocale: "en",
    noTranslate: [],

    translationFn: simpleTranslation,
  });

  runner.run();
}

// This should cause the example/build/new-locale/fr/common.json file
// to be created, even though there is just an empty "fr" folder as source
function newLocaleExample() {
  const runner = createRunner({
    dest: "example/build/new-locale",
    dir: "example/new-locale/locales",
    isQuiet: false,
    mainLocale: "en",
    noTranslate: [],

    translationFn: simpleTranslation,
  });

  runner.run();
}

// This should cause the example/build/new-locale/fr/common.json file
// to be created, even though there is just an empty "fr" folder as source
function flatExample() {
  const runner = createRunner({
    dest: "example/build/flat",
    dir: "example/flat/locales",
    isQuiet: false,
    mainLocale: "en",
    noTranslate: [],

    translationFn: simpleTranslation,
  });

  runner.run();
}

nestedExample();
flatExample();
newLocaleExample();
