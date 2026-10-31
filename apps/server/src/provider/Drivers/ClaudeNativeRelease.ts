import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

// `claude update` installs what this bucket names, which trails npm during a release.
const CLAUDE_RELEASES_URL = "https://downloads.claude.ai/claude-code-releases";
const LOOKUP_TIMEOUT_MS = 4_000;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

const decodeUpdateChannelSettings = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ autoUpdatesChannel: Schema.optional(Schema.String) })),
);

export const lookupClaudeNativeLatestVersion = Effect.fn("lookupClaudeNativeLatestVersion")(
  function* (settingsPath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const client = yield* HttpClient.HttpClient;
    const channel = yield* fileSystem.readFileString(settingsPath).pipe(
      Effect.flatMap(decodeUpdateChannelSettings),
      Effect.map((settings) => (settings.autoUpdatesChannel === "stable" ? "stable" : "latest")),
      Effect.orElseSucceed(() => "latest"),
    );
    const body = yield* client
      .execute(HttpClientRequest.get(`${CLAUDE_RELEASES_URL}/${channel}`))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
        Effect.timeoutOption(LOOKUP_TIMEOUT_MS),
        Effect.orElseSucceed(() => Option.none<string>()),
      );
    const version = Option.getOrElse(body, () => "").trim();
    return RELEASE_VERSION.test(version) ? version : null;
  },
);
