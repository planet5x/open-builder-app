// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInteractiveStore } from "../store/interactive";
import { useSettingsStore } from "../store/settings";
import { ChatInterface } from "./ChatInterface";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
  }),
}));

vi.mock("./chat/ChatHeader", () => ({ ChatHeader: () => null }));
vi.mock("./chat/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("./chat/ChatInput", () => ({
  ChatInput: (props: {
    input: string;
    onChange: (value: string) => void;
    onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
    forcedSkillIds: readonly string[];
    onForcedSkillIdsChange: (ids: string[]) => void;
  }) => (
    <div>
      <output aria-label="selected skills">
        {props.forcedSkillIds.join(",")}
      </output>
      <button
        type="button"
        onClick={() => {
          props.onChange("Build it");
          props.onForcedSkillIdsChange(["code-review"]);
        }}
      >
        Prepare request
      </button>
      <form aria-label="composer" onSubmit={props.onSubmit}>
        <button type="submit">Send</button>
      </form>
    </div>
  ),
}));

const baseProps = {
  messages: [],
  isGenerating: false,
  hasValidSettings: true,
  onStop: vi.fn(),
  onOpenSettings: vi.fn(),
  onSetFiles: vi.fn(),
  onImportProject: vi.fn(() => ({ ok: true as const })),
  files: {},
  template: "vite-react-ts",
  previewMode: "sandpack" as const,
  sandpackKey: 0,
  isProjectInitialized: false,
  showInlinePreview: false,
  onCompressContext: vi.fn(async () => undefined),
  onRetry: vi.fn(async () => undefined),
  onContinue: vi.fn(async () => undefined),
  onReview: vi.fn(async () => undefined),
  onHealthCheck: vi.fn(async () => undefined),
};

describe("ChatInterface forced Skills", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useInteractiveStore.setState({ pending: [] });
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("passes the one-request selection to generation and clears it immediately after send", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn(async () => undefined);
    render(<ChatInterface {...baseProps} onGenerate={onGenerate} />);

    await user.click(screen.getByRole("button", { name: "Prepare request" }));
    expect(screen.getByLabelText("selected skills")).toHaveTextContent(
      "code-review",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith("Build it", undefined, {
        forcedSkillIds: ["code-review"],
      }),
    );
    expect(screen.getByLabelText("selected skills")).toBeEmptyDOMElement();
  });
});
