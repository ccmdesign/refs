# Module tagger adapters

Point `tagger.adapter` in `library/config.yaml` at a local file, or set `REFS_TAGGER` to a path (resolved from the current working directory).

Paths in the config file resolve from the library folder (where `config.yaml` lives).

## Interface

```ts
type TaggerCheck = { ok: boolean; detail: string; models?: string[] };

type DescribeInput = {
  prompt: string;
  imagePath: string; // prepared JPEG, max 1024px
  model?: string;
};

interface TaggerAdapter {
  id: string;
  check(): Promise<TaggerCheck>;
  describe(input: DescribeInput): Promise<string>; // raw model text; core parses JSON
}
```

## Export forms

The module’s default export may be:

1. A `TaggerAdapter` object with `check` and `describe`, or
2. A factory `(cfg: TaggerConfig) => TaggerAdapter | Promise<TaggerAdapter>`.

If neither form validates, loading fails with `<path> does not export a tagger adapter`.

## Example adapter (~25 lines)

Save as `library/my-tagger.mjs`:

```js
export default function create(cfg) {
  return {
    id: "my-tagger",
    async check() {
      return { ok: true, detail: `ready (model ${cfg.model ?? "default"})` };
    },
    async describe({ prompt, imagePath, model }) {
      // Call your model; return the raw text (JSON tags + description).
      return JSON.stringify({
        tags: ["example"],
        description: `Saw ${imagePath} with model ${model ?? cfg.model}`,
      });
    },
  };
}
```

Config:

```yaml
tagger:
  adapter: ./my-tagger.mjs
  model: my-vision-model
```

Core supplies the prompt and vocabulary; your adapter only needs to return the model’s text response.
