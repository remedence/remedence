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
  closeDisabled?: boolean;
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
  closeDisabled = false,
}: DialogLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const requestClose = () => {
    if (!closeDisabled) onClose();
  };

  useDialogFocus({
    open: true,
    layerRef,
    initialFocusRef,
    restoreFocusRef,
    onClose: requestClose,
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
          requestClose();
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
