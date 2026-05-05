export const VERIFICATION_WINDOW_HOURS = 24;

export const DEFAULT_PACKAGES = [
  { hours: 5,  price: 3000, badge: null,        save: null },
  { hours: 10, price: 5500, badge: 'Best Value', save: 500 },
  { hours: 15, price: 8000, badge: null,         save: 1000 },
] as const;

export const DEFAULT_TOPICS: Record<string, string[]> = {
  'Mathematics':       ['Algebra','Functions','Trigonometry','Geometry','Statistics','Calculus','Sequences & Series','Finance Math'],
  'Physical Sciences': ['Mechanics','Waves & Sound','Electricity','Magnetism','Chemical Bonding','Reactions','Stoichiometry','Organic Chem'],
  'Life Sciences':     ['Cell Biology','Genetics','Evolution','Ecology','Human Systems','Plants'],
  'English':           ['Essay writing','Language','Poetry','Novel','Drama','Comprehension'],
  'Accounting':        ['Balance Sheet','Income Statement','Cash Flow','Ratios','VAT','Payroll'],
};

export const SUBJECT_SUGGESTIONS = [
  'Mathematics', 'Physical Sciences', 'Life Sciences', 'English',
  'Accounting', 'Geography', 'History', 'Business Studies',
];
