import type { KeyEvent } from "@opentui/core";

export type ViewId = "typing" | "results";

export type TestResults = {
  wpm: number;
  accuracy: number;
  errors: number;
  durationSec: number;
};

export interface View {
  id: ViewId;
  mount(): void;
  show(): void;
  hide(): void;
  layout(): void;
  handleKey(key: KeyEvent): boolean;
  tick?(nowMs: number): void;
}
