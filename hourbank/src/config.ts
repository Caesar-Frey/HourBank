export const VERIFICATION_WINDOW_HOURS = 24;

export const DEFAULT_PACKAGES = [
  { hours: 5,  price: 3000, badge: null,        save: null },
  { hours: 10, price: 5500, badge: 'Best Value', save: 500 },
  { hours: 15, price: 8000, badge: null,         save: 1000 },
] as const;


export const SUBJECT_SUGGESTIONS = [
  'Mathematics', 'Physical Sciences', 'Life Sciences', 'English',
  'Accounting', 'Geography', 'History', 'Business Studies',
];
