import type { KeyEvent } from "@opentui/core";

import type { View, ViewId } from "./types";

export class ViewManager {
  private views = new Map<ViewId, View>();
  private activeView: View | null = null;

  register(view: View) {
    if (this.views.has(view.id)) {
      return;
    }
    view.mount();
    view.hide();
    this.views.set(view.id, view);
  }

  show(id: ViewId) {
    const next = this.views.get(id);
    if (!next) {
      return;
    }
    if (this.activeView && this.activeView.id === id) {
      this.activeView.show();
      this.activeView.layout();
      return;
    }
    this.activeView?.hide();
    this.activeView = next;
    next.show();
    next.layout();
  }

  handleKey(key: KeyEvent) {
    if (!this.activeView) {
      return false;
    }
    return this.activeView.handleKey(key);
  }

  layout() {
    this.activeView?.layout();
  }

  tick(nowMs: number) {
    this.activeView?.tick?.(nowMs);
  }

  get activeId() {
    return this.activeView?.id ?? null;
  }
}
