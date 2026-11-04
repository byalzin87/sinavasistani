export interface Option {
  label: string; // A, B, C, D, E
  text: string;
}

export interface Question {
  id: number;
  text: string;
  options: Option[];
  correctAnswerLabel: string | null; // A, B, C... parsed from answer key or AI
  userSelection: string | null; // A, B, C...
}

export interface Exam {
  id: string;
  title: string;
  dateCreated: string;
  questions: Question[];
  isFinished: boolean;
}

export interface Folder {
  id: string;
  name: string;
  exams: Exam[];
}

export type AppView = 'DASHBOARD' | 'FOLDER_DETAIL' | 'EXAM_TAKER' | 'LOADING' | 'STATISTICS' | 'SETTINGS';