// Offline banner + Home retry on reconnect: the transition logic behind the NetInfo listener.
import { describe, expect, it } from "vitest";
import { isOffline, trackConnectivity, type NetSnapshot } from "../src/lib/connectivity";

const ON: NetSnapshot = { isConnected: true, isInternetReachable: true };
const NO_LINK: NetSnapshot = { isConnected: false, isInternetReachable: false };
const WIFI_NO_INTERNET: NetSnapshot = { isConnected: true, isInternetReachable: false };
const UNKNOWN: NetSnapshot = { isConnected: null, isInternetReachable: null };

describe("isOffline", () => {
  it("only a definite no counts", () => {
    expect(isOffline(ON)).toBe(false);
    expect(isOffline(NO_LINK)).toBe(true);
    expect(isOffline(WIFI_NO_INTERNET)).toBe(true); // captive portal / dead router
    expect(isOffline(UNKNOWN)).toBe(false); // cold start: no banner flash
    expect(isOffline({ isConnected: true })).toBe(false);
  });
});

describe("trackConnectivity", () => {
  function run(states: NetSnapshot[]) {
    const events: boolean[] = [];
    const feed = trackConnectivity((off) => events.push(off));
    states.forEach(feed);
    return events;
  }

  it("fires only on flips: one offline, one reconnect", () => {
    expect(run([UNKNOWN, ON, ON, NO_LINK, NO_LINK, WIFI_NO_INTERNET, ON, ON])).toEqual([true, false]);
  });

  it("never reports a reconnect without a preceding offline", () => {
    expect(run([ON, UNKNOWN, ON])).toEqual([]);
  });

  it("each outage gets its own reconnect", () => {
    expect(run([NO_LINK, ON, NO_LINK, ON])).toEqual([true, false, true, false]);
  });
});
