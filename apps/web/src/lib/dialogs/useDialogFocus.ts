import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
}

interface UseDialogFocusOptions {
  open: boolean;
  layerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function useDialogFocus({
  open,
  layerRef,
  initialFocusRef,
  restoreFocusRef,
  onClose,
}: UseDialogFocusOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const layer = layerRef.current;
    if (!layer) return;

    const parent = layer.parentElement;
    const backgroundSiblings = parent
      ? Array.from(parent.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element !== layer,
        )
      : [];
    const priorInertState = backgroundSiblings.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
    }));

    for (const element of backgroundSiblings) element.setAttribute("inert", "");

    let addedLayerTabIndex = false;
    const focusTarget =
      initialFocusRef?.current ?? getFocusableElements(layer)[0] ?? layer;
    if (focusTarget === layer && !layer.hasAttribute("tabindex")) {
      layer.setAttribute("tabindex", "-1");
      addedLayerTabIndex = true;
    }
    focusTarget.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(layer);
      if (!focusable.length) {
        event.preventDefault();
        layer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      const focusOutsideLayer = !active || !layer.contains(active);

      if (event.shiftKey && (active === first || focusOutsideLayer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || focusOutsideLayer)) {
        event.preventDefault();
        first.focus();
      }
    };

    layer.addEventListener("keydown", handleKeyDown);

    return () => {
      layer.removeEventListener("keydown", handleKeyDown);
      if (addedLayerTabIndex) layer.removeAttribute("tabindex");
      for (const { element, inert } of priorInertState) {
        if (!inert) element.removeAttribute("inert");
      }
      restoreFocusRef?.current?.focus();
    };
  }, [open, layerRef, initialFocusRef, restoreFocusRef]);
}
