export interface LocaleInfo {
  locale: string;
  file: Record<string, Record<string, string>>;
}

export type AITranslation = (
  prompt: string,
  json: string,
  locales: Array<string>
) => Promise<string>;
