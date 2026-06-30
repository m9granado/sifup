"use client";

import type { ButtonHTMLAttributes } from "react";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button, type ButtonProps } from "./button";

export interface CopyButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick">,
    Pick<ButtonProps, "variant" | "size" | "className"> {
  value: string;
  label?: string;
  copiedLabel?: string;
  successDurationMs?: number;
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  successDurationMs = 1400,
  variant = "outline",
  size = "sm",
  className,
  disabled,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), successDurationMs);
    return () => window.clearTimeout(timeout);
  }, [copied, successDurationMs]);

  async function handleClick() {
    if (!value || disabled) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleClick}
      disabled={disabled}
      aria-live="polite"
      {...props}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span>{copied ? copiedLabel : label}</span>
    </Button>
  );
}
