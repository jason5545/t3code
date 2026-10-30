import type { EnvironmentId } from "@t3tools/contracts";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";

import { connectionAtomRuntime } from "./runtime";
import { parseTailnetEntryUrls } from "./tailnetEntryUrls";

/**
 * Fork patch 7: a phone with no environment probes the build's entry servers
 * and offers the ones that answer. Android only: this fork builds no iOS app,
 * and the no-redirect transport below is verified on Android's network stack.
 */
export const tailnetEntryUrls: ReadonlyArray<string> =
  Platform.OS === "android" ? readEntryUrls(Constants.expoConfig?.extra?.tailnetEntryUrls) : [];

function readEntryUrls(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  try {
    return parseTailnetEntryUrls(value.filter((entry) => typeof entry === "string").join(","));
  } catch {
    return [];
  }
}

/**
 * HTTPS checks only the host a request reaches, so a redirect from a
 * misconfigured proxy could carry the token exchange elsewhere. expo/fetch
 * turns off OkHttp's redirects for this request alone (React Native's fetch
 * always follows them); a 3xx then fails the step as an undeclared status.
 */
const fetchWithoutRedirects = ((input: RequestInfo | URL, init?: RequestInit) =>
  expoFetch(String(input instanceof Request ? input.url : input), {
    ...(init as object),
    redirect: "manual",
    credentials: "omit",
  })) as unknown as typeof fetch;

export const layerHttpClientWithoutRedirects = layerRemoteHttpClient(fetchWithoutRedirects);

export interface TailnetEntryCandidate {
  readonly httpBaseUrl: string;
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

const PROBE_INTERVAL = "15 seconds";
const PROBE_TIMEOUT_MS = 5_000;

const probeEntries = Effect.forEach(
  tailnetEntryUrls,
  (httpBaseUrl) =>
    fetchRemoteEnvironmentDescriptor({ httpBaseUrl, timeoutMs: PROBE_TIMEOUT_MS }).pipe(
      Effect.map((descriptor) =>
        Option.some<TailnetEntryCandidate>({
          httpBaseUrl,
          environmentId: descriptor.environmentId,
          label: descriptor.label,
        }),
      ),
      Effect.orElseSucceed(() => Option.none<TailnetEntryCandidate>()),
    ),
  { concurrency: "unbounded" },
).pipe(Effect.map(Arr.getSomes), Effect.provide(layerHttpClientWithoutRedirects));

/** Probed again every 15 seconds while read, so a Tailscale that connects late is still found. */
export const tailnetEntryCandidatesAtom = connectionAtomRuntime
  .atom(Stream.fromEffectSchedule(probeEntries, Schedule.spaced(PROBE_INTERVAL)))
  .pipe(Atom.withLabel("mobile:connection:tailnet-entry-candidates"));
