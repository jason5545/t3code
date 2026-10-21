import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_PROVIDER_INSTANCES, ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ServerSettingsModule from "./serverSettings.ts";

const layerServerSettings = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-fork-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings (fork)", (it) => {
  it.effect("persists added and removed instances that match a built-in default", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const ompId = ProviderInstanceId.make("omp");
      const readPersisted = fileSystem
        .readFileString(serverConfig.settingsPath)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings))));
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"claudeAgent":{"driver":"claudeAgent","enabled":false}}}',
      );

      yield* serverSettings.updateProviderInstance({
        operation: "create",
        instanceId: ompId,
        instance: DEFAULT_PROVIDER_INSTANCES[ompId]!,
      });
      assert.deepEqual(
        (yield* readPersisted).providerInstances[ompId],
        DEFAULT_PROVIDER_INSTANCES[ompId],
      );

      yield* serverSettings.updateProviderInstance({ operation: "remove", instanceId: ompId });
      yield* serverSettings.updateProviderInstance({
        operation: "remove",
        instanceId: ProviderInstanceId.make("claudeAgent"),
      });
      assert.deepEqual((yield* readPersisted).providerInstances, {});
    }).pipe(Effect.provide(layerServerSettings())),
  );
});
