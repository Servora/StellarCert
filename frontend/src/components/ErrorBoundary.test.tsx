import React, { lazy, Suspense } from "react";
import { render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

// ErrorBoundary calls useLocation so it can reset itself on navigation, which
// means every render of it needs a router in the tree.
const render = (ui: React.ReactElement) =>
  rtlRender(ui, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });

function Boom({ message = "boom" }: { message?: string }): React.ReactElement {
  throw new Error(message);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children while no error has been thrown", () => {
    render(
      <ErrorBoundary>
        <p>safe content</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("safe content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("renders the default fallback with the thrown message", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom message="certificate exploded" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("certificate exploded")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it("prefers a custom fallback when one is provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<p>custom failure UI</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("custom failure UI")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("clears the error and calls onReset when Try again is clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReset = vi.fn();
    const user = userEvent.setup();

    render(
      <ErrorBoundary onReset={onReset}>
        <Boom />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("contains a lazy chunk whose import rejects instead of unmounting the tree", async () => {
    // The failure mode behind #744: a `React.lazy` import that rejects (bad
    // module specifier on a case-sensitive filesystem, stale hashed asset after
    // a deploy, offline) used to bubble up and blank the whole page.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const FailingChunk = lazy(async () => {
      throw new Error(
        "Failed to fetch dynamically imported module: /assets/NotFound-abc123.js",
      );
    });

    render(
      <ErrorBoundary>
        <Suspense fallback={<p>loading</p>}>
          <FailingChunk />
        </Suspense>
      </ErrorBoundary>,
    );

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText(/Failed to fetch dynamically imported module/),
    ).toBeInTheDocument();
  });
});
