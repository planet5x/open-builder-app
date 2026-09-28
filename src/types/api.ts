// ─── Interactive tool types (ask_user_question, exit_plan_mode) ─────────────

export interface AskUserQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
}

export interface AskUserAnswerItem {
  question: string;
  header: string;
  selected: string[];
}

export interface AskUserAnswers {
  answers: AskUserAnswerItem[];
}

export type PlanDecision =
  | { approved: true }
  | { approved: false; feedback?: string };
