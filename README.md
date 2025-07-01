# JSON AI Translation

This package makes it simple to keep a project's translation files
up to date using AI. It is ideal for the use case where you do all
your language edits in a single locale file, e.g. `en`, then want
OpenAI to automatically translate just the changed or new strings into
all the other locales. You can then either check these in, or open
a pull request to send these suggestions to human translaters.

Note that for this tool to detect which strings have changed
in your main locale file, you should run this before committing that
file to git.

## Getting Started

Install the package from NPM

```bash
npm install -g json-ai-translation
```

[![JSON AI Translation](https://github.com/user-attachments/assets/e1a70a43-78f2-4148-afa8-78a6b0dc869b)](https://youtu.be/97ZOc9MhM0w?si=cjySF--e4MKqufXg "JSON AI Translation")

## CLI Usage

The package assumes that you keep all your files to be translated in a single folder,
with each non-nested sub-folder being named after the locale it represents. E.g.

```bash
public/locales/en/common.json
public/locales/de/common.json
public/locales/es/common.json
public/locales/ko/common.json
```

Alternatively, you can have a single file per locale, e.g.

```bash
public/locales/en.json
public/locales/de.json
public/locales/es.json
```

You must tell the script which locale is the authoritive one from which all
other locales are translated. The example below assumes that your OpenAI API key
is in the `OPENAI_API_KEY` environment variable.

```bash
json-ai-translation --dir public/locales --main en --openaitoken \"$OPENAI_API_KEY\"
```

Alternatively, to use Anthropic, assuming your API key is in the `ANTHROPIC_API_KEY`
environment variable

```bash
json-ai-translation --dir public/locales --main en --anthropicaitoken \"$ANTHROPIC_API_KEY\"
```

This will cause all other locale files in the `public/locales` folder to be updated, using
OpenAI/Anthropic to translate from the authoritive locale into all the others.

Only values that have changed in the main locale will be updated, so if you have manually edited
values in the locale files previously, those will remain unchanged.

## Adding a new locale

To add a new locale, simply create a new folder with that locale code, e.g. Portuguese, if you are organizing your files in sub-folders:

```bash
public/locales/pt
```

If you are using a single file per locale, create a new empty JSON text file:

```bash
public/locales/pt.json
```

Then, you can run the `json-ai-translation` command again with the same parameters as before.
All the content in the main locale will be translated by AI and written to the new locale.

## Building to another folder

If you want to the leave the source files unchanged, set the `--dest` argument to the path to another folder, e.g.

```bash
json-ai-translation --dir public/locales --dest build/locales --main en --openaitoken \"$OPENAI_API_KEY\"
```

## Parameters

| Parameter          | Description                                                                                                                          | Type    |           |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------ | :-------- |
| --dir              | The folder in which the locale files are stored                                                                                      | String  | Required  |
| --main             | The primary locale code, e.g. --main en                                                                                              | String  | Required  |
| --openaitoken      | Your OpenAI token, required unless an Anthropic token is provided                                                                    | String  | Required? |
| --anthropicaitoken | Your AnthropicAI token, required unless an OpenAI token is provided                                                                  | String  | Required? |
| --dest             | The folder in which the translated locale files written. Defaults to the same as --dir                                               | String  | Optional  |
| --aimodel          | Override the default AI model for either OpenAI or Anthropic                                                                         | String  | Optional  |
| --notranslate      | A list of strings that should not be translated. For example, product names. E.g. `--notranslate "My Cool App" "My Company Name"`    | Boolean | Optional  |
| --quiet            | Do not log anything to the console when running                                                                                      | Boolean | Optional  |
| --force            | Force the translation of all strings in the main locale files, even if they have not changed. This will be slower and more expensive | Boolean | Optional  |

## License

MIT
