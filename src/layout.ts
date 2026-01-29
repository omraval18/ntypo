import { FrameBufferRenderable, RGBA, TextRenderable } from "@opentui/core";

export type PromptSize = {
  width: number;
  height: number;
};

export function computePromptSize(
  terminalWidth: number,
  terminalHeight: number,
): PromptSize {
  const safeWidth = terminalWidth > 0 ? terminalWidth : 80;
  const safeHeight = terminalHeight > 0 ? terminalHeight : 24;

  const availableWidth = Math.max(1, safeWidth - 4);
  const width = Math.max(10, Math.min(80, availableWidth));

  const availableHeight = Math.max(1, safeHeight - 6);
  const height = Math.max(3, Math.min(8, Math.floor(availableHeight * 0.3)));

  return { width, height };
}

export function applyLayout(
  terminalWidth: number,
  terminalHeight: number,
  prompt: FrameBufferRenderable,
  header: TextRenderable,
  footer: TextRenderable,
): PromptSize {
  const safeWidth = terminalWidth > 0 ? terminalWidth : 80;
  const safeHeight = terminalHeight > 0 ? terminalHeight : 24;
  const { width, height } = computePromptSize(safeWidth, safeHeight);

  prompt.width = width;
  prompt.height = height;
  prompt.frameBuffer.resize(width, height);
  prompt.frameBuffer.clear(RGBA.fromValues(0, 0, 0, 0));
  prompt.left = Math.max(0, Math.floor((safeWidth - width) / 2));
  prompt.top = Math.max(0, Math.floor((safeHeight - height) / 2));

  header.left = 2;
  header.top = 1;

  footer.left = 2;
  footer.top = Math.max(0, safeHeight - 2);

  return { width, height };
}
