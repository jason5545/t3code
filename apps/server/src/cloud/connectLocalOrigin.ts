// Fork patch 32: T3 Connect's link checks accept only a loopback origin, so a
// tailnet-bound server keeps 127.0.0.1, where the fork's loopback forwarder listens.
import * as NetAddress from "effect/net/NetAddress";

import { loopbackUrlHostForAddress } from "../startupAccess.ts";

export const connectLocalOrigin = (address: NetAddress.InetAddress): string =>
  `http://${
    NetAddress.isUnspecified(address.address) || NetAddress.isLoopback(address.address)
      ? loopbackUrlHostForAddress(address)
      : "127.0.0.1"
  }:${address.port}`;
