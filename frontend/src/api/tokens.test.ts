import { describe, it, expect, vi } from "vitest";
import * as tokens from "./tokens";
import { notifyTokenRefreshed, subscribeTokenRefresh } from "./tokens";

describe("token refresh subscriptions (#1329)", () => {
  it("notifies every subscriber, so one cannot drop another", () => {
    const auth = vi.fn();
    const notifications = vi.fn();
    const unsubscribeAuth = subscribeTokenRefresh(auth);
    const unsubscribeNotifications = subscribeTokenRefresh(notifications);

    notifyTokenRefreshed("token-1");

    expect(auth).toHaveBeenCalledWith("token-1", undefined);
    expect(notifications).toHaveBeenCalledWith("token-1", undefined);

    unsubscribeAuth();
    unsubscribeNotifications();
  });

  it("only removes the unsubscribed listener", () => {
    const kept = vi.fn();
    const removed = vi.fn();
    const unsubscribeKept = subscribeTokenRefresh(kept);
    const unsubscribeRemoved = subscribeTokenRefresh(removed);

    unsubscribeRemoved();
    notifyTokenRefreshed("token-2");

    expect(kept).toHaveBeenCalledWith("token-2", undefined);
    expect(removed).not.toHaveBeenCalled();

    unsubscribeKept();
  });

  it("does not expose a setter that replaces all subscribers", () => {
    expect("setTokenRefreshCallback" in tokens).toBe(false);
  });
});
