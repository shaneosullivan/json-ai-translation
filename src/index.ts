// Update all locale files from the source locale, using OPENAI

import { parseArgs } from "util";
import fs from "fs";
import { join } from "path";
import {
  flattenJSONFile,
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

const args = parseArgs({
  options: {
    dir: { type: "string" },
    main: { type: "string" },
    openaitoken: { type: "string" },
    notranslate: { type: "string", multiple: true },
  },
}).values;

const dir = args.dir || "";
const mainLocale = args.main || "";
const openAIToken = args.openaitoken || "";
const noTranslate = args.notranslate || "";

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

  const missingKeys = getMissingKeys(localesInfo, mainLocale);

  const mainLocaleChanges = getGitDiffKeys(localesInfo, mainLocale);

  const keysForFileName: Record<string, Array<string>> = {};

  Object.keys(mainLocaleChanges.changed).forEach((fileName) => {
    keysForFileName[fileName] = getUniqueStringArray(
      mainLocaleChanges.changed[fileName],
      missingKeys[fileName] || []
    );
  });

  const mainLocaleInfo = localesInfo.find(
    (localeInfo) => localeInfo.locale === mainLocale
  );

  let totalKeyModifiedCount = 0;
  let totalKeyDeletedCount = 0;

  if (mainLocaleInfo) {
    await updateAllLocaleFiles(
      mainLocaleInfo,
      keysForFileName,
      localesInfo,
      mainLocaleChanges.deleted
    );

    {
      Object.keys(keysForFileName).forEach(
        (fileName) =>
          (totalKeyModifiedCount += keysForFileName[fileName].length)
      );

      Object.keys(mainLocaleChanges.deleted).forEach(
        (fileName) =>
          (totalKeyDeletedCount += mainLocaleChanges.deleted[fileName].length)
      );
    }
  }

  return [totalKeyModifiedCount, totalKeyDeletedCount];
}

async function updateAllLocaleFiles(
  mainLocaleInfo: LocaleInfo,
  keysForFileName: Record<string, Array<string>>,
  localesInfo: Array<LocaleInfo>,
  deletedFileKeys: Record<string, Array<string>>
) {
  const fileNames = Object.keys(mainLocaleInfo.file);

  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i];

    const keys = keysForFileName[fileName];
    const deletedKeys = deletedFileKeys[fileName] || [];

    if (deletedKeys.length > 0) {
      localesInfo.forEach((localeInfo) => {
        deletedKeys.forEach((key) => {
          delete localeInfo.file[fileName][key];
        });
      });
    }

    await updateLocaleFile(fileName, mainLocaleInfo, keys, localesInfo);
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

      const fileContent: Record<string, string> =
        flattenJSONFile(filePath, code !== mainLocale) || {};
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

function getMissingKeys(
  localesInfo: Array<LocaleInfo>,
  mainLocale: string
): Record<string, Array<string>> {
  const missingKeys: Record<string, Array<string>> = {};
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
          return;
        }

        const fileRecord = localeInfo.file[fileName];
        fileKeys.forEach((fileKey) => {
          if (!fileRecord[fileKey]) {
            if (!missingKeys[fileName]) {
              missingKeys[fileName] = [];
            }
            missingKeys[fileName].push(fileKey);
          }
        });
      });
    });
  }

  return missingKeys;
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
  const [totalKeyModified, totalKeyDeleted] = result || [];
  console.log(
    "Completed updating i18n resources. ",
    totalKeyModified,
    " keys updated, ",
    totalKeyDeleted,
    "keys deleted"
  );
});
