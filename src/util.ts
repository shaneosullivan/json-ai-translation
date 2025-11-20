import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";

export function listFoldersInPath(path: string): string[] {
  // Read all the contents of the directory
  const contents = readdirSync(path);

  // Filter only the folders
  const folders = contents.filter((item) => {
    const itemPath = join(path, item); // Get the full path of the item
    return statSync(itemPath).isDirectory(); // Check if the item is a directory
  });

  return folders;
}

export function listFilesInPath(path: string): string[] {
  // Read all the contents of the directory
  const contents = readdirSync(path);

  // Filter only the folders
  const folders = contents.filter((item) => {
    const itemPath = join(path, item); // Get the full path of the item
    return !statSync(itemPath).isDirectory(); // Check if the item is a directory
  });

  return folders;
}

export function isValidLocale(locale: string): boolean {
  const localeRegex = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;
  return localeRegex.test(locale);
}

const PERIOD_ESC = "~|~";

export function flattenJSON(
  jsonObject: any,
  parentKey = "",
  result: { [key: string]: any } = {}
): { [key: string]: any } {
  for (const key in jsonObject) {
    if (jsonObject.hasOwnProperty(key)) {
      const escapedKey = key.split(".").join(PERIOD_ESC);
      const newKey = parentKey ? `${parentKey}.${escapedKey}` : escapedKey;
      if (typeof jsonObject[key] === "object" && jsonObject[key] !== null) {
        // Recursively flatten the nested object
        flattenJSON(jsonObject[key], newKey, result);
      } else {
        // Assign the value to the flattened key
        result[newKey] = jsonObject[key];
      }
    }
  }
  return result;
}

export function flattenJSONFile(
  filePath: string,
  useGitSource = false,
  isQuiet = true
): { [key: string]: any } {
  // Read the JSON file

  let fileContents: string = "{}";

  if (useGitSource) {
    try {
      const gitDiffCommand = `git show HEAD:${filePath}`;
      fileContents =
        execSync(
          gitDiffCommand,
          isQuiet
            ? {
                stdio: ["pipe", "pipe", "ignore"],
              }
            : undefined
        )
          .toString()
          .trim() || "{}";
    } catch (error) {
      fileContents = "{}"; // Default to empty object if file does not exist in history
    }
  } else if (existsSync(filePath)) {
    fileContents = readFileSync(filePath, "utf-8").toString().trim() || "{}";
  }

  // Parse the JSON
  const jsonObject = JSON.parse(fileContents);

  // Flatten the JSON object
  return flattenJSON(jsonObject);
}

// Function to execute git diff and compare JSON file changes
export function getGitDiffJSON(
  filePath: string,
  forceTranslateAll = false
): {
  replaced: string[];
  deleted: string[];
  added: string[];
} {
  // Read the current contents of the file
  const currentFileContents =
    readFileSync(filePath, "utf-8").toString().trim() || "{}";
  const currentJson = JSON.parse(currentFileContents);

  // Flatten the current JSON
  const flattenedCurrentJson = flattenJSON(currentJson);

  // Execute git diff to get the previous version of the file
  const gitDiffCommand = `git show HEAD:${filePath}`;
  let previousFileContents: string = "{}";

  if (!forceTranslateAll) {
    try {
      previousFileContents = execSync(gitDiffCommand).toString();
    } catch (error) {
      console.error(
        "Error executing git diff or file doesn't exist in git history."
      );
      previousFileContents = "{}"; // Default to empty object if file does not exist in history
    }
  }

  // Parse the previous file (if it exists in git)
  const previousJson = JSON.parse(previousFileContents);
  const flattenedPreviousJson = flattenJSON(previousJson);

  // Compare the two flattened JSON objects
  const replaced: string[] = [];
  const deleted: string[] = [];
  const added: string[] = [];

  // Find replaced and deleted keys
  for (const key in flattenedPreviousJson) {
    if (flattenedPreviousJson.hasOwnProperty(key)) {
      if (key in flattenedCurrentJson) {
        const areArrays =
          Array.isArray(flattenedPreviousJson[key]) &&
          Array.isArray(flattenedCurrentJson[key]);

        const areEqual = areArrays
          ? JSON.stringify(flattenedPreviousJson[key]) ===
            JSON.stringify(flattenedCurrentJson[key])
          : flattenedPreviousJson[key] === flattenedCurrentJson[key];

        if (!areEqual) {
          replaced.push(key); // Value was changed
        }
      } else {
        deleted.push(key); // Key no longer exists
      }
    }
  }

  // Find added keys
  for (const key in flattenedCurrentJson) {
    if (forceTranslateAll) {
      replaced.push(key); // New key added
    } else {
      if (flattenedCurrentJson.hasOwnProperty(key)) {
        if (!(key in flattenedPreviousJson)) {
          added.push(key); // New key added
        }
      }
    }
  }

  return { replaced, deleted, added };
}

export function getUniqueStringArray(
  array1: Array<string>,
  array2: Array<string>
): string[] {
  const uniqueArray: Array<string> = [];
  const seen = new Set<string>();

  // Process first array
  for (const item of array1) {
    if (!seen.has(item)) {
      uniqueArray.push(item);
      seen.add(item);
    }
  }

  // Process second array
  for (const item of array2) {
    if (!seen.has(item)) {
      uniqueArray.push(item);
      seen.add(item);
    }
  }

  return uniqueArray;
}

export function unflattenJSON(
  flattened: Record<string, string>
): Record<string, any> {
  const result: { [key: string]: any } = {};

  for (const flatKey in flattened) {
    if (flattened.hasOwnProperty(flatKey)) {
      const keys = flatKey.split("."); // Split the key by periods to create nested structure
      let currentLevel = result;

      // Iterate over the keys to create nested objects
      keys.forEach((key, index) => {
        const unescapedKey = key.split(PERIOD_ESC).join(".");
        if (index === keys.length - 1) {
          // If this is the last key, assign the value
          currentLevel[unescapedKey] = flattened[flatKey];
        } else {
          // If the key doesn't exist at this level, create an empty object
          if (!currentLevel[unescapedKey]) {
            currentLevel[unescapedKey] = {};
          }
          // Move deeper into the object
          currentLevel = currentLevel[unescapedKey];
        }
      });
    }
  }

  return result;
}

export function stringifyWithNewlines(obj: any): string {
  // First, stringify the object with standard pretty-print formatting (2 spaces indentation)
  const jsonString = JSON.stringify(obj, null, 2);

  // Post-process the string to add a newline after each closing curly brace that signifies the end of an object
  return jsonString.replace(/},\n/g, "},\n\n");
}

export function getCommonStrings(arrays: Array<Array<string>>): Array<string> {
  if (arrays.length === 0) {
    return [];
  }

  // Create a map to count occurrences of each string
  const stringCount = new Map<string, number>();
  const totalArrays = arrays.length;

  // Iterate over each array only once
  arrays.forEach((array) => {
    const uniqueStrings = new Set(array); // Use Set to ensure each string is counted once per array
    uniqueStrings.forEach((str) => {
      stringCount.set(str, (stringCount.get(str) || 0) + 1);
    });
  });

  // Filter the strings that appear in all arrays
  const result: string[] = [];
  stringCount.forEach((count, str) => {
    if (count === totalArrays) {
      result.push(str);
    }
  });

  return result;
}

export function chunkArray<T>(arr: T[], bucketSize: number): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < arr.length; i += bucketSize) {
    result.push(arr.slice(i, i + bucketSize));
  }

  return result;
}

export function ensureDirectoryExists(relativePath: string): void {
  const absolutePath = resolve(relativePath);

  // Check if the directory already exists
  if (!existsSync(absolutePath)) {
    // Create the directory and any necessary parent directories
    mkdirSync(absolutePath, { recursive: true });
  }
}

export function trimQuotes(input: string): string {
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1);
  }
  return input;
}
