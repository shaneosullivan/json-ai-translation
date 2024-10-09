#!/usr/bin/env node
// Update all locale files from the source locale, using OPENAI

import { parseArgs } from "util";
import fs from "fs";
import { join } from "path";
import {
  chunkArray,
  flattenJSONFile,
  getCommonStrings,
  getGitDiffJSON,
  getUniqueStringArray,
  isValidLocale,
  listFilesInPath,
  listFoldersInPath,
  stringifyWithNewlines,
  unflattenJSON,
} from "./util";
import OpenAI from "openai";

/*
  Steps:
    1 - Read all locale files
    2 - Flatten them all
    3 - Get a list of all values in the source file that have changed, using git
    4 - Translate all these values into all the required languages
    5 - Apply these changes to all the locales
    6 - Write the changes back to the files, nesting where appropriate.
*/

interface LocaleInfo {
  locale: string;
  file: Record<string, Record<string, string>>;
}

// How many keys to process in one go
const BUCKET_SIZE = 50;

const args = parseArgs({
  options: {
    dir: { type: "string" },
    main: { type: "string" },
    openaitoken: { type: "string" },
    notranslate: { type: "string", multiple: true },
    quiet: { type: "boolean" },
  },
}).values;

const dir = args.dir || "";
const mainLocale = args.main || "";
const openAIToken = args.openaitoken || "";
const noTranslate = args.notranslate || "";
const isQuiet = !!args.quiet;

function log(...args: Array<any>) {
  if (isQuiet) {
    return;
  }
  console.log(...args);
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

if (!validateArgs()) {
  process.exit(0);
}

const openai = new OpenAI({
  apiKey: openAIToken,
});

async function exec() {
  // Read the locale codes
  const localeCodes = getLocaleCodes();

  if (!localeCodes) {
    return;
  }

  if (localeCodes.indexOf(mainLocale) < 0) {
    console.error("Main locale ", mainLocale, " not found in dir ", dir);
    return;
  }

  const localesInfo = getFileContentForCodes(localeCodes);

  const mainLocaleChanges = getGitDiffKeys(localesInfo, mainLocale);

  // We treat missing keys differently, as they might just be for a single
  // locale, e.g when we add a completely new locale file. We don't want
  // to generate a full new file for all locales, just for this one.
  let missingKeys = getMissingKeys(localesInfo, mainLocale);

  // Get all the missing keys that are missing from all the locales.
  // We can efficiently include these with the initial remote call
  // as they will translate in all locales in a single shot
  const commonMissingKeys = getCommonMissingKeys(missingKeys);

  const keysForFileName: Record<string, Array<string>> = {};

  Object.keys(mainLocaleChanges.changed).forEach((fileName) => {
    keysForFileName[fileName] = getUniqueStringArray(
      mainLocaleChanges.changed[fileName],
      commonMissingKeys[fileName] || []
    );
  });

  const mainLocaleInfo = localesInfo.find(
    (localeInfo) => localeInfo.locale === mainLocale
  );

  let totalKeyModifiedCount = 0;
  let totalKeyDeletedCount = 0;
  let totalKeyNewCount = 0;

  if (mainLocaleInfo) {
    // Process all the changed i18n keys. This only includes missing keys
    // that are missing in all locales
    await updateAllLocaleFiles(
      mainLocaleInfo,
      keysForFileName,
      localesInfo,
      mainLocaleChanges.deleted,
      "Added/Changed Keys"
    );

    // Now that we have done the single efficient call to translate common
    // keys to all languages, let's process any missing keys that are
    // present in some locales, not present in others.
    // We'll do it locale by locale, as the most likely scenario here is that
    // a new locale has been added, or this is the first time
    // the script has been run on repo that has never had anything
    // localized.
    missingKeys = getMissingKeys(localesInfo, mainLocale);

    if (missingKeys.length > 0) {
      for (let i = 0; i < missingKeys.length; i++) {
        const keyInfo = missingKeys[i];

        await updateAllLocaleFiles(
          mainLocaleInfo,
          keyInfo.files,
          // Only process this one locale
          localesInfo.filter(
            (localeInfo) => localeInfo.locale === keyInfo.locale
          ),
          // No need to delete any keys, we did that earlier
          {},
          `Missing Keys [${keyInfo.locale}]`
        );
      }
    }

    {
      Object.keys(keysForFileName).forEach(
        (fileName) =>
          (totalKeyModifiedCount += keysForFileName[fileName].length)
      );

      Object.keys(mainLocaleChanges.deleted).forEach(
        (fileName) =>
          (totalKeyDeletedCount += mainLocaleChanges.deleted[fileName].length)
      );

      missingKeys.forEach((missingKeyInfo) => {
        Object.keys(missingKeyInfo.files).forEach((fileName) => {
          totalKeyNewCount += missingKeyInfo.files[fileName].length;
        });
      });
    }
  }

  return [totalKeyModifiedCount, totalKeyDeletedCount, totalKeyNewCount];
}

async function updateAllLocaleFiles(
  mainLocaleInfo: LocaleInfo,
  keysForFileName: Record<string, Array<string>>,
  localesInfo: Array<LocaleInfo>,
  deletedFileKeys: Record<string, Array<string>>,
  logName: string
) {
  const fileNames = Object.keys(mainLocaleInfo.file);

  let totalKeysToUpdate = 0;
  fileNames.forEach((fileName) => {
    totalKeysToUpdate += (keysForFileName[fileName] || []).length;
  });

  if (totalKeysToUpdate > 0) {
    log(logName, ": Processing", totalKeysToUpdate, "keys");

    for (let i = 0; i < fileNames.length; i++) {
      const fileName = fileNames[i];

      const keys = keysForFileName[fileName];

      if (keys) {
        const deletedKeys = deletedFileKeys[fileName] || [];

        if (deletedKeys.length > 0) {
          localesInfo.forEach((localeInfo) => {
            deletedKeys.forEach((key) => {
              delete localeInfo.file[fileName][key];
            });
          });
        }

        const chunks = chunkArray(keys, BUCKET_SIZE);

        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j];
          await updateLocaleFile(fileName, mainLocaleInfo, chunk, localesInfo);
          log(
            logName,
            `[${fileName}]`,
            ": Processed ",
            BUCKET_SIZE * j + chunks[j].length,
            " of ",
            keys.length
          );
        }
      }
    }
  }
}

async function updateLocaleFile(
  fileName: string,
  mainLocaleInfo: LocaleInfo,
  keys: Array<string>,
  localesInfo: Array<LocaleInfo>
) {
  const localeCodes = localesInfo
    .map((localeInfo) => localeInfo.locale)
    .filter((localeCode) => localeCode !== mainLocale);

  const mainFileContents = mainLocaleInfo.file[fileName];
  const filteredFileContents: Record<string, string> = {};

  if (keys.length > 0) {
    keys.forEach((key) => (filteredFileContents[key] = mainFileContents[key]));

    // We now have an object with all the source (probably english) modified
    // key/value pairs. Time to send it to OpenAI for translation
    const result = await translateJSON(localeCodes, filteredFileContents);

    // Apply the translation result to the locale files
    // The result looks like
    /*
  {
    pl: {
      "benefits.der": "Godziny spokoju",
      "benefits.pictures": "Wiele więcej obrazków do kolorowania, gier do grania i więcej!",
    },
    lv: {
      "benefits.der": "Stundas klusuma un miera",
      "benefits.pictures": "Daudz vairāk attēlu krāsošanai, spēles spēlēšanai un vēl vairāk!",
    }
    ....
  */
    const translatedLocales = Object.keys(result);
    translatedLocales.forEach((locale) => {
      const translatedContent = result[locale];
      const localeInfo = localesInfo.find(
        (localeInfo) => localeInfo.locale === locale
      );

      if (localeInfo) {
        // Copy the translated copy into the source of truth
        Object.keys(translatedContent).forEach((key) => {
          localeInfo.file[fileName][key] = translatedContent[key];
        });
      }
    });
  }

  localesInfo
    .filter((localeInfo) => localeInfo.locale !== mainLocale)
    .forEach((localeInfo) => {
      const newFileContent = unflattenJSON(localeInfo.file[fileName]);

      fs.writeFileSync(
        join(dir, localeInfo.locale, fileName),
        stringifyWithNewlines(newFileContent)
      );
    });
}

function getFileContentForCodes(localeCodes: Array<string>): Array<LocaleInfo> {
  const localesInfo: Array<LocaleInfo> = [];

  // List the files in the main folder.
  const localeFiles = listFilesInPath(join(dir, mainLocale));

  localeCodes.forEach((code) => {
    const filesContent: Record<string, Record<string, string>> = {};

    localeFiles.forEach((fileName) => {
      const filePath = join(dir, code, fileName);

      let fileContent: Record<string, string> =
        flattenJSONFile(filePath, code !== mainLocale, isQuiet) || {};

      // If we are using the git source, and the file is empty,
      // there is a chance that it is a brand new file that we have already
      // generated, but not yet checked in.  Use the file on disk, and not the
      // git version in that case
      if (Object.keys(fileContent).length === 0 && code !== mainLocale) {
        fileContent = flattenJSONFile(filePath, false, isQuiet) || {};
      }

      filesContent[fileName] = fileContent;
    });

    localesInfo.push({
      locale: code,
      file: filesContent,
    });
  });

  return localesInfo;
}
function getGitDiffKeys(localesInfo: Array<LocaleInfo>, mainLocale: string) {
  const changedKeys: Record<string, Array<string>> = {};
  const deletedKeys: Record<string, Array<string>> = {};
  const mainLocaleInfo = localesInfo.find(
    (localeInfo) => localeInfo.locale === mainLocale
  );

  if (mainLocaleInfo) {
    // Go through the files in the main locales, and match its keys against the other files.
    const fileNames = Object.keys(mainLocaleInfo.file);
    fileNames.forEach((fileName) => {
      const gitInfo = getGitDiffJSON(join(dir, mainLocale, fileName));

      changedKeys[fileName] = gitInfo.added.concat(gitInfo.replaced);
      deletedKeys[fileName] = gitInfo.deleted;
    });
  }

  return {
    changed: changedKeys,
    deleted: deletedKeys,
  };
}

interface MissingKeys {
  locale: string;
  files: Record<string, Array<string>>;
}

function getMissingKeys(
  localesInfo: Array<LocaleInfo>,
  mainLocale: string
): Array<MissingKeys> {
  const missingKeys: Array<MissingKeys> = [];
  const mainLocaleInfo = localesInfo.find(
    (localeInfo) => localeInfo.locale === mainLocale
  );

  if (mainLocaleInfo) {
    // Go through the files in the main locales, and match its keys against the other files.
    const fileNames = Object.keys(mainLocaleInfo.file);
    fileNames.forEach((fileName) => {
      const fileKeys = Object.keys(mainLocaleInfo.file[fileName]);

      localesInfo.forEach((localeInfo) => {
        if (localeInfo.locale === mainLocale) {
          // Skip the main locale, it is the source of truth
          return;
        }

        let missingKeyInfo = missingKeys.find(
          (info) => info.locale === localeInfo.locale
        );

        if (!missingKeyInfo) {
          missingKeys.push(
            (missingKeyInfo = {
              files: {},
              locale: localeInfo.locale,
            })
          );
        }

        const fileRecord = localeInfo.file[fileName];
        fileKeys.forEach((fileKey) => {
          if (!fileRecord[fileKey]) {
            if (missingKeyInfo) {
              if (!missingKeyInfo.files[fileName]) {
                missingKeyInfo.files[fileName] = [];
              }
              missingKeyInfo.files[fileName].push(fileKey);
            }
          }
        });
      });
    });
  }

  return missingKeys;
}

function getCommonMissingKeys(
  missingKeys: Array<MissingKeys>
): Record<string, Array<string>> {
  const commonKeys: Record<string, Array<string>> = {};

  if (missingKeys.length > 1) {
    const fileNames = Object.keys(missingKeys[0].files);

    fileNames.forEach((fileName) => {
      const fileMissingKeys: Array<Array<string>> = [];

      for (let i = 0; i < missingKeys.length; i++) {
        fileMissingKeys.push(missingKeys[i].files[fileName]);
      }
      const commonMissingKeys = getCommonStrings(fileMissingKeys);
      commonKeys[fileName] = commonMissingKeys;
    });
  }

  return commonKeys;
}

function getLocaleCodes() {
  const folders = listFoldersInPath(dir);

  const invalidFolderNames: Array<string> = [];
  folders.forEach((folderName) => {
    if (!isValidLocale(folderName)) {
      invalidFolderNames.push(folderName);
    }
  });

  if (invalidFolderNames.length > 0) {
    console.error("Invalid locale codes found in ", dir, invalidFolderNames);
    return null;
  }
  return folders;
}

async function translateJSON(
  locales: Array<string>,
  mainLocaleValues: Record<string, string>
): Promise<Record<string, Record<string, string>>> {
  const doNotTranslatePrompt =
    noTranslate && noTranslate.length > 0
      ? `
    Do not translate the following terms: ${noTranslate
      .map((item) => `"${item}"`)
      .join(", ")}
  `
      : "";

  const prompt = `
  Translate the following JSON from English into the languages: ${locales.filter(
    (locale) => locale !== mainLocale
  )}. ${doNotTranslatePrompt}. Reply in JSON, grouped by locale. 
  Do not include any code block formatting, only respond with raw JSON.
  ${JSON.stringify(mainLocaleValues)}
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    let messageContent = response.choices[0].message.content;

    // Parse the response as JSON
    const translatedJSON = messageContent ? JSON.parse(messageContent) : {};

    return translatedJSON;
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

exec().then((result) => {
  const [totalKeyModified, totalKeyDeleted, totalKeyNewCount] = result || [];
  log(
    "Completed updating i18n resources. ",
    totalKeyModified,
    " keys updated, ",
    totalKeyDeleted,
    " keys deleted",
    totalKeyNewCount,
    " new keys added"
  );
});
