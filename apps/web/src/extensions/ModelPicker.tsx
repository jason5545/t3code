import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import { withImplicitFastModeDefault } from "@t3tools/shared/model";

import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "../components/chat/ComposerModelEffort";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import {
  resolveCompatibleRuntimeMode,
  resolveRuntimeModeOptions,
} from "../components/chat/runtimeModeConfig";
import type { TraitsSelectionInput } from "../components/chat/TraitsPicker";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { getAppModelOptionsForInstance, type AppModelOption } from "../modelSelection";
import { providerInstanceEntriesFor } from "../providerInstances";
import { getProviderModelCapabilities } from "../providerModels";
import { useManagedPolicy } from "../state/managedPolicy";
import { environmentServerConfigsAtom } from "../state/server";

/**
 * Fork patch 30, API 7: upstream's `ProviderModelPicker` fed the way `ChatComposer` feeds it, so
 * favorites, hidden models and order, legacy models, effort, speed and permissions behave as in
 * the composer. The extension holds the value.
 */

export interface ExtensionModelValue {
  readonly instanceId: string;
  readonly model: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
}

export interface ExtensionModelPickerProps {
  readonly project: { readonly environmentId: string; readonly projectId: string } | null;
  /** The selection shown, such as `useStartOptions(project).selection` until the user picks. */
  readonly value: ExtensionModelValue | null;
  readonly onChange: (value: ExtensionModelValue) => void;
  /** With both, the popup's footer carries the permissions toggle, as in the composer. */
  readonly runtimeMode?: RuntimeMode | null;
  readonly onRuntimeModeChange?: (mode: RuntimeMode) => void;
  readonly disabled?: boolean;
  readonly size?: "sm" | "xs";
  readonly popupAlign?: "start" | "end";
}

const noPromptEdit = () => {};

export function ModelPicker(props: ExtensionModelPickerProps) {
  if (props.project === null || props.value === null) return null;
  return <ModelPickerFor {...props} project={props.project} value={props.value} />;
}

function ModelPickerFor(
  props: ExtensionModelPickerProps & {
    readonly project: NonNullable<ExtensionModelPickerProps["project"]>;
    readonly value: ExtensionModelValue;
  },
) {
  const { value, onChange } = props;
  const environmentId = EnvironmentId.make(props.project.environmentId);
  const settings = useEnvironmentSettings(environmentId);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const managedPolicy = useManagedPolicy(environmentId);
  const providers = configs.get(environmentId)?.providers ?? [];
  const entries = providerInstanceEntriesFor(
    providers,
    settings,
    ProjectId.make(props.project.projectId),
  );
  const instanceId = ProviderInstanceId.make(value.instanceId);
  const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of entries) {
    modelOptionsByInstance.set(
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === instanceId ? value.model : null,
      ),
    );
  }
  const entry = entries.find((candidate) => candidate.instanceId === instanceId);
  const size = props.size ?? "sm";
  const traits: TraitsSelectionInput | null = entry
    ? {
        provider: entry.driverKind,
        instanceId,
        model: value.model,
        models: entry.models,
        modelOptions: withImplicitFastModeDefault(
          getProviderModelCapabilities(entry.models, value.model, entry.driverKind),
          value.options as ReadonlyArray<ProviderOptionSelection>,
        ),
        promptUltrathink: "none",
        onPromptEdit: noPromptEdit,
        // No prompt to type "ultrathink" into, so effort is always the option itself.
        allowPromptInjectedEffort: false,
        onModelOptionsChange: (next) =>
          onChange({
            instanceId: value.instanceId,
            model: value.model,
            options: (next ?? []).map(({ id, value: optionValue }) => ({ id, value: optionValue })),
          }),
      }
    : null;
  const effort = describeComposerEffort(traits, settings.effortDisplay, size);
  const runtimeMode = props.runtimeMode ?? null;
  const onRuntimeModeChange = props.onRuntimeModeChange;
  const runtime =
    runtimeMode !== null && onRuntimeModeChange !== undefined
      ? resolveCompatibleRuntimeMode(runtimeMode, entry?.snapshot.supportedRuntimeModes)
      : null;
  return (
    <ProviderModelPicker
      environmentId={environmentId}
      activeInstanceId={instanceId}
      model={value.model}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={modelOptionsByInstance}
      size={size}
      popupAlign={props.popupAlign ?? "start"}
      disabled={props.disabled ?? false}
      triggerClassName="group/model-trigger min-w-13 data-popup-open:bg-accent data-popup-open:text-foreground"
      triggerSuffix={effort.suffix}
      triggerDetail={effort.detail}
      effortColumn={<ComposerEffortColumn traits={traits} />}
      {...(runtime !== null && onRuntimeModeChange !== undefined
        ? {
            footer: (
              <ComposerPickerFooter
                traits={traits}
                runtimeMode={runtime.mode}
                runtimeModeOptions={resolveRuntimeModeOptions(runtime.modes, managedPolicy)}
                onRuntimeModeChange={onRuntimeModeChange}
              />
            ),
          }
        : {})}
      onInstanceModelChange={(nextInstanceId, nextModel) => {
        if (nextInstanceId === instanceId && nextModel === value.model) return;
        // A new model starts from its own defaults, as a fresh draft does.
        onChange({ instanceId: nextInstanceId, model: nextModel, options: [] });
      }}
    />
  );
}
