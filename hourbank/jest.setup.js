/**
 * jest.setup.js — runs after Jest framework is initialised for every test file.
 * Mocks native / Expo modules so that DB tests work under plain Node.js.
 */

// ─── expo-sqlite → better-sqlite3 bridge ──────────────────────────────────
// expo-sqlite v16 API used in this project:
//   db.runSync(sql, params?)       → { changes: number }
//   db.getAllSync(sql, params?)
//   db.getFirstSync(sql, params?)
//   db.withTransactionSync(fn)
// We bridge these to better-sqlite3's synchronous API.

// Use require() inside the factory so Babel hoisting doesn't cause
// "out-of-scope variable" errors. Variable name starts with "mock" per
// Jest's exception rule for hoisted mocks.
jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mockBetterSQLite = require('better-sqlite3');

  function mockWrap(bsDb) {
    return {
      _bsDb: bsDb,

      runSync(sql, params) {
        const stmt = bsDb.prepare(sql);
        const info = params !== undefined
          ? stmt.run(...(Array.isArray(params) ? params : [params]))
          : stmt.run();
        return { changes: info.changes };
      },

      getAllSync(sql, params) {
        const stmt = bsDb.prepare(sql);
        if (params !== undefined) {
          return stmt.all(...(Array.isArray(params) ? params : [params]));
        }
        return stmt.all();
      },

      getFirstSync(sql, params) {
        const stmt = bsDb.prepare(sql);
        if (params !== undefined) {
          return stmt.get(...(Array.isArray(params) ? params : [params])) ?? null;
        }
        return stmt.get() ?? null;
      },

      withTransactionSync(fn) {
        bsDb.transaction(fn)();
      },
    };
  }

  return {
    openDatabaseSync: (_name) => {
      const bsDb = new mockBetterSQLite(':memory:');
      bsDb.pragma('journal_mode = WAL');
      bsDb.pragma('foreign_keys = ON');
      return mockWrap(bsDb);
    },
  };
});

// ─── expo-crypto ──────────────────────────────────────────────────────────
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('crypto').randomUUID(),
}));

// ─── Silence expo-font warnings ───────────────────────────────────────────
jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));

// ─── react-native-safe-area-context ───────────────────────────────────────
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 375, height: 812 }),
}));

// ─── expo-router ──────────────────────────────────────────────────────────
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  },
  Link: ({ children }) => children,
  Stack: { Screen: () => null },
  Tabs: { Screen: () => null },
}));
