interface AutoTranslateMessage {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
}

interface AutoTranslateOptions {
  readonly catalogFile?: string;
  readonly runtimeFile: string;
  readonly roots: ReadonlyArray<string>;
  readonly onMessage?: (message: AutoTranslateMessage) => void;
}

declare function autoTranslate(
  babel: object,
  options: AutoTranslateOptions,
): { readonly name: string; readonly visitor: object };

export = autoTranslate;
