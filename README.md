# JSON AI Translation

This package makes it simple to keep a project its translation files
up to date using AI.

## Getting Started

Install the package from NPM

```bash
npm install -g json-ai-translation
```

## CLI Usage

The package assumes that you keep all your files to be translated in a single folder,
with each non-nested sub-folder being named after the locale it represents. E.g.

```
public/locales/en/common.json
public/locales/de/common.json
public/locales/es/common.json
public/locales/ko/common.json
```

You must tell the script which locale is the authoritive one from which all
other locales are translated. The example below assumes that your OpenAI API key
is in the `OPENAI_API_KEY` environment variable

```bash
json-ai-translation --dir public/locales --main en --openaitoken \"$OPENAI_API_KEY\"
```

This will cause all other locale files in the `public/locales` folder to be updated, using
OpenAI to translate from the authoritive locale into all the others.

Only values that have changed in the main locale will be updated, so if you have manually edited
values in the locale files previously, those will remain unchanged.

## Parameters

| Parameter     | Description                                                                                                                       |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| --dir         | The folder in which the locale files are stored                                                                                   |
| --openaitoken | Your OpenAI token                                                                                                                 |
| --notranslate | A list of strings that should not be translated. For example, product names. E.g. `--notranslate "My Cool App" "My Company Name"` |

## License

MIT
