import { useMemo } from "react";
import { mergeMessages } from "../lib/utils/merge-messages";
import type { Message, MergedMessage } from "../types";
import { useT } from "../i18n";

export function useMergedMessages(messages: Message[]): MergedMessage[] {
  const t = useT();
  return useMemo(() => mergeMessages(messages, t), [messages, t]);
}
