import type { ExtensionContribution, ExtensionInfo } from "@t3tools/shared/extensions";
import { ArrowLeftRightIcon } from "lucide-react";
import { Component, createContext, use, type ComponentType, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { interfaceSwitchLabel } from "../locale/assembledText";
import { localizeServerMessage } from "../locale/serverMessages";
import { resolveInterfaceSwitch } from "./interfaceSwitch";
import { selectExtensionInterface, useExtensionRuntime } from "./runtime";

type InterfaceContribution = ExtensionContribution<ComponentType<object>>;

export const APP_INTERFACE_POINT = "app.interface";
const NONE: ReadonlyArray<InterfaceContribution> = [];

/** Where the switch button leads: an extension's interface, or the standard one for null. */
interface InterfaceSwitch {
  readonly id: string | null;
  readonly label: string;
}

/** Null while no extension offers an interface, so the standard sidebar draws no button. */
const InterfaceSwitchContext = createContext<InterfaceSwitch | null>(null);

/** The standard sidebar's switch button, in the footer's row of icon buttons. */
export function AppInterfaceSwitcher() {
  const next = use(InterfaceSwitchContext);
  if (next === null) return null;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={next.label}
              onClick={() => selectExtensionInterface(next.id)}
              size="icon"
            >
              <ArrowLeftRightIcon />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{next.label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/** An interface that throws while drawing hands the window back to the standard one. */
class InterfaceBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    selectExtensionInterface(null);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "That interface could not be drawn",
        description: "The standard interface is back.",
      }),
    );
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Wraps the standard app shell. With no extension offering an interface it draws the shell
 * unchanged. Otherwise the standard sidebar gains a switch button, and a chosen interface is
 * drawn in place of the shell with the same button in the window's bottom left corner. The
 * button is the host's, so an interface cannot leave the window without a way back.
 */
export function createAppInterface(
  builtIn: ReadonlyArray<InterfaceContribution>,
  extensions: ReadonlyArray<ExtensionInfo>,
) {
  const builtInTitles = new Map(extensions.map(({ id, title }) => [id, title]));
  return function AppInterface({ children }: { readonly children: ReactNode }) {
    const { disabled, installed, titles, selectedInterface } = useExtensionRuntime();
    // One interface per extension: its first contribution.
    const offered = new Map<string, ComponentType<object>>();
    for (const { id, contribution } of [
      ...builtIn.filter(({ id }) => !disabled.has(id)),
      ...(installed.get(APP_INTERFACE_POINT) ?? NONE),
    ]) {
      if (!offered.has(id)) offered.set(id, contribution);
    }

    const state = resolveInterfaceSwitch([...offered.keys()], selectedInterface);
    const Active =
      state === null || state.activeId === null ? undefined : offered.get(state.activeId);
    const nextId = state?.nextId ?? null;
    const next: InterfaceSwitch | null =
      state === null
        ? null
        : {
            id: nextId,
            label: interfaceSwitchLabel(
              nextId === null
                ? null
                : localizeServerMessage(titles.get(nextId) ?? builtInTitles.get(nextId) ?? nextId),
            ),
          };

    // The provider is always there, so an interface arriving or leaving never remounts the shell.
    if (Active === undefined || next === null) {
      return <InterfaceSwitchContext value={next}>{children}</InterfaceSwitchContext>;
    }
    return (
      <>
        <InterfaceBoundary key={state?.activeId}>
          <Active />
        </InterfaceBoundary>
        <div className="fixed bottom-2 left-2 z-50">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={next.label}
                  onClick={() => selectExtensionInterface(next.id)}
                  size="icon-sm"
                  variant="outline"
                >
                  <ArrowLeftRightIcon />
                </Button>
              }
            />
            <TooltipPopup side="top">{next.label}</TooltipPopup>
          </Tooltip>
        </div>
      </>
    );
  };
}
