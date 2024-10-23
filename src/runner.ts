import {
  chunkArray,
  ensureDirectoryExists,
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
import fs from "fs";
import { join } from "path";
import { AITranslation, LocaleInfo } from "./types";

// How many keys to process in one go
const BUCKET_SIZE = 25;

interface RunnerOptions {
  dest: string;
  dir: string;
  isQuiet: boolean;
  translationFn: AITranslation;
  mainLocale: string;
  noTranslate: Array<string>;
  forceTranslateAll?: boolean;
}

export interface Runner {
  run: () => Promise<Array<number>>;
  log: (...args: Array<any>) => void;
}

export function createRunner(options: RunnerOptions): Runner {
  const {
    dir,
    dest,
    isQuiet,
    mainLocale,
    noTranslate,
    translationFn,
    forceTranslateAll,
  } = options;

  function log(...args: Array<any>) {
    if (isQuiet) {
      return;
    }
    console.log(...args);
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
            await updateLocaleFile(
              fileName,
              mainLocaleInfo,
              chunk,
              localesInfo
            );
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
      keys.forEach(
        (key) => (filteredFileContents[key] = mainFileContents[key])
      );

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
        const reorderedLocaleFileInfo: Record<string, string> = {};
        const translatedLocaleFileInfo = localeInfo.file[fileName];

        // Ensure that the keys are in the same order. This effects how
        // they are nested when unflattened.
        Object.keys(mainFileContents).forEach((key, idx) => {
          if (translatedLocaleFileInfo[key] !== undefined) {
            reorderedLocaleFileInfo[key] = translatedLocaleFileInfo[key];
          }
        });

        const newFileContent = unflattenJSON(reorderedLocaleFileInfo);

        ensureDirectoryExists(join(dest, localeInfo.locale));

        fs.writeFileSync(
          join(dest, localeInfo.locale, fileName),
          stringifyWithNewlines(newFileContent)
        );
      });
  }

  function getFileContentForCodes(
    localeCodes: Array<string>
  ): Array<LocaleInfo> {
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
        const gitInfo = getGitDiffJSON(
          join(dir, mainLocale, fileName),
          !!forceTranslateAll
        );

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
  Translate the following JSON from the locale ${mainLocale} into the languages: ${locales.filter(
      (locale) => locale !== mainLocale
    )}. ${doNotTranslatePrompt}. Reply in JSON, grouped by locale. Do not include the locale ${mainLocale}
  Do not include any code block formatting, only respond with raw JSON.
  `;

    try {
      let messageContent = await translationFn(
        prompt,
        JSON.stringify(mainLocaleValues),
        locales
      );

      // Parse the response as JSON
      const translatedJSON = messageContent ? JSON.parse(messageContent) : {};

      return translatedJSON;
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  }

  return {
    run: async () => {
      const localeCodes = getLocaleCodes();

      if (!localeCodes) {
        return [];
      }

      if (localeCodes.indexOf(mainLocale) < 0) {
        console.error("Main locale ", mainLocale, " not found in dir ", dir);
        return [];
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
              (totalKeyDeletedCount +=
                mainLocaleChanges.deleted[fileName].length)
          );

          missingKeys.forEach((missingKeyInfo) => {
            Object.keys(missingKeyInfo.files).forEach((fileName) => {
              totalKeyNewCount += missingKeyInfo.files[fileName].length;
            });
          });
        }
      }

      return [totalKeyModifiedCount, totalKeyDeletedCount, totalKeyNewCount];
    },
    log,
  };
}
