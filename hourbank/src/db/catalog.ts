import { getDb } from './client';
import { newId } from './uuid';

// ── Types ─────────────────────────────────────────────────────────────────

export type Subject = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Topic = {
  id: string;
  subject_id: string;
  name: string;
  sort_order: number;
  /** 1 for topics the tutor typed (addCustomTopicForSubject); 0 for the seeded catalog. */
  is_custom?: number;
  created_at: string;
  updated_at: string;
};

export type Curriculum = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

// ── Default seed data ─────────────────────────────────────────────────────

type SubjectSeed = { name: string; topics: string[] };

const SUBJECT_SEEDS: SubjectSeed[] = [
  {
    name: 'Mathematics',
    topics: ['Algebra', 'Calculus', 'Geometry', 'Statistics', 'Trigonometry', 'Functions', 'Sequences & Series', 'Finance Math'],
  },
  {
    name: 'Physics',
    topics: ['Mechanics', 'Waves', 'Electricity', 'Magnetism', 'Optics', 'Thermodynamics', 'Nuclear Physics'],
  },
  {
    name: 'Chemistry',
    topics: ['Chemical Bonding', 'Stoichiometry', 'Organic Chemistry', 'Acids & Bases', 'Electrochemistry', 'Reactions'],
  },
  {
    name: 'Biology',
    topics: ['Cell Biology', 'Genetics', 'Evolution', 'Ecology', 'Human Systems', 'Plants', 'Microbiology'],
  },
  {
    name: 'English',
    topics: ['Essay Writing', 'Language', 'Poetry', 'Novel', 'Drama', 'Comprehension', 'Grammar'],
  },
  {
    name: 'Afrikaans',
    topics: ['Opstel', 'Taalstudie', 'Poësie', 'Roman', 'Drama', 'Begripstoets'],
  },
  {
    name: 'History',
    topics: ['Source Analysis', 'Essay', 'World War I', 'World War II', 'Cold War', 'South African History', 'Civil Rights'],
  },
  {
    name: 'Geography',
    topics: ['Mapwork', 'Climate', 'Geomorphology', 'Development', 'Population', 'Resources'],
  },
  {
    name: 'Life Sciences',
    topics: ['Cell Biology', 'Genetics', 'Evolution', 'Ecology', 'Human Systems', 'Plants'],
  },
  {
    name: 'Accounting',
    topics: ['Balance Sheet', 'Income Statement', 'Cash Flow', 'Ratios', 'VAT', 'Payroll', 'Partnerships'],
  },
  {
    name: 'Business Studies',
    topics: ['Management', 'Marketing', 'Operations', 'Finance', 'Entrepreneurship', 'Business Environments'],
  },
  {
    name: 'Economics',
    topics: ['Microeconomics', 'Macroeconomics', 'Supply & Demand', 'Market Structures', 'Development Economics'],
  },
  {
    name: 'Computer Science',
    topics: ['Algorithms', 'Data Structures', 'Databases', 'Networks', 'Object-Oriented Programming', 'Problem Solving'],
  },
];

const CURRICULUM_SEEDS = ['CAPS', 'IEB', 'Cambridge', 'Other'];

// ── Reads ─────────────────────────────────────────────────────────────────

export function listSubjects(): Subject[] {
  const db = getDb();
  return db.getAllSync<Subject>('SELECT * FROM subjects ORDER BY sort_order, name');
}

export function listTopicsForSubject(subjectId: string): Topic[] {
  const db = getDb();
  return db.getAllSync<Topic>(
    'SELECT * FROM topics WHERE subject_id = ? ORDER BY sort_order, name',
    [subjectId]
  );
}

export function listAllTopics(): Topic[] {
  const db = getDb();
  return db.getAllSync<Topic>('SELECT * FROM topics ORDER BY sort_order, name');
}

// SA curriculum: some student subject names map to multiple seeded subjects
const SUBJECT_ALIASES: Record<string, string[]> = {
  'physical sciences': ['physics', 'chemistry'],
  'mathematical literacy': ['mathematics'],
  'life sciences': ['life sciences', 'biology'],
};

export function listTopicsForStudentSubject(subjectName: string): Topic[] {
  const subjects = listSubjects();
  const normalized = subjectName.trim().toLowerCase();

  // Exact match first
  const exact = subjects.find(s => s.name.trim().toLowerCase() === normalized);
  if (exact) {
    return listTopicsForSubject(exact.id);
  }

  // Alias match: combine topics from multiple seeded subjects, deduped by name
  const aliasNames = SUBJECT_ALIASES[normalized];
  if (aliasNames) {
    const matched = subjects.filter(s => aliasNames.includes(s.name.trim().toLowerCase()));
    if (matched.length > 0) {
      const seen = new Set<string>();
      const combined: Topic[] = [];
      for (const s of matched) {
        for (const t of listTopicsForSubject(s.id)) {
          if (!seen.has(t.name)) {
            seen.add(t.name);
            combined.push(t);
          }
        }
      }
      return combined;
    }
  }

  // Fallback: all topics deduped by name (handles custom/unrecognised subjects)
  const seen = new Set<string>();
  return listAllTopics().filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

/**
 * Inserts a custom topic for the subject that matches subjectName.
 * Uses the same alias/fallback logic as listTopicsForStudentSubject.
 * Silent no-op for empty names or exact duplicates (case-insensitive).
 */
export function addCustomTopicForSubject(subjectName: string, topicName: string): void {
  const trimmed = topicName.trim();
  if (!trimmed) return;

  const db = getDb();
  const subjects = listSubjects();
  const normalized = subjectName.trim().toLowerCase();

  // Resolve subject id using same logic as listTopicsForStudentSubject
  let subjectId: string | null = null;

  const exact = subjects.find(s => s.name.trim().toLowerCase() === normalized);
  if (exact) {
    subjectId = exact.id;
  } else {
    const aliasNames = SUBJECT_ALIASES[normalized];
    if (aliasNames) {
      const matched = subjects.filter(s => aliasNames.includes(s.name.trim().toLowerCase()));
      if (matched.length > 0) subjectId = matched[0].id;
    }
  }

  if (!subjectId && subjects.length > 0) {
    // Fallback: first subject (topics are broadly useful)
    subjectId = subjects[0].id;
  }

  if (!subjectId) return;

  // Duplicate check
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM topics WHERE LOWER(name) = LOWER(?) AND subject_id = ?',
    [trimmed, subjectId]
  );
  if (existing) return;

  const now = new Date().toISOString();
  db.runSync(
    'INSERT INTO topics (id, subject_id, name, sort_order, is_custom, created_at, updated_at) VALUES (?, ?, ?, 9999, 1, ?, ?)',
    [newId(), subjectId, trimmed, now, now]
  );
}

export function listCurricula(): Curriculum[] {
  const db = getDb();
  return db.getAllSync<Curriculum>('SELECT * FROM curricula ORDER BY name');
}

// ── Seeding ───────────────────────────────────────────────────────────────

/**
 * Seeds default subjects, topics, and curricula if the tables are empty.
 * Idempotent: checks row count before inserting.
 */
export function seedCatalog(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Check if subjects table already has data
  const subjectCount = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM subjects'
  );
  if (!subjectCount || subjectCount.count === 0) {
    db.withTransactionSync(() => {
      SUBJECT_SEEDS.forEach((seed, subjectIndex) => {
        const subjectId = newId();
        db.runSync(
          'INSERT INTO subjects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [subjectId, seed.name, subjectIndex, now, now]
        );
        seed.topics.forEach((topicName, topicIndex) => {
          db.runSync(
            'INSERT INTO topics (id, subject_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [newId(), subjectId, topicName, topicIndex, now, now]
          );
        });
      });
    });
  }

  // Check if curricula table already has data
  const curriculumCount = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM curricula'
  );
  if (!curriculumCount || curriculumCount.count === 0) {
    db.withTransactionSync(() => {
      CURRICULUM_SEEDS.forEach(name => {
        db.runSync(
          'INSERT INTO curricula (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [newId(), name, now, now]
        );
      });
    });
  }
}
