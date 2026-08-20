import { type ReactNode, type RefObject, useRef } from "react";
import { useDialogFocus } from "./useDialogFocus";

interface DialogLayerProps {
  children: ReactNode;
  layerClassName: string;
  dialogClassName: string;
  labelledBy: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  element?: "aside" | "section";
  closeOnBackdrop?: boolean;
}

export function DialogLayer({
  children,
  layerClassName,
  dialogClassName,
  labelledBy,
  onClose,
  initialFocusRef,
  restoreFocusRef,
  element = "section",
  closeOnBackdrop = true,
}: DialogLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  useDialogFocus({
    open: true,
    layerRef,
    initialFocusRef,
    restoreFocusRef,
    onClose,
  });

  const dialogProps = {
    className: dialogClassName,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": labelledBy,
  } as const;

  return (
    <div
      ref={layerRef}
      className={layerClassName}
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {element === "aside" ? (
        <aside {...dialogProps}>{children}</aside>
      ) : (
        <section {...dialogProps}>{children}</section>
      )}
    </div>
  );
}
