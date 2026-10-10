import { applyLessonSavedNav, lessonSavedNav, NavStateLike, studentPageInStack, truncateToStudentPage } from '../lessonNav';

const home = { name: '(app)', state: { routes: [{ name: 'index' }], index: 0 } };
const studentStack = (...routes: { name: string; params?: object }[]): { name: string; state: NavStateLike } => ({
  name: 'student',
  state: { routes, index: routes.length - 1 },
});
const page = (id: string) => ({ name: '[id]/index', params: { id } });
const timer = (id: string) => ({ name: '[id]/session', params: { id, sessionId: 'sess-1' } });
const review = (id: string) => ({ name: '[id]/end-session', params: { id, sessionId: 'sess-1' } });
const logPast = (id: string) => ({ name: '[id]/log-past', params: { id } });

describe('studentPageInStack', () => {
  test('log past opened from the student page', () => {
    const state = { routes: [home, studentStack(page('s1'), logPast('s1'))], index: 1 };
    expect(studentPageInStack(state, 's1')).toBe(true);
    expect(studentPageInStack(state, 's2')).toBe(false);
  });

  test('lesson started from the student page (timer in a later student stack)', () => {
    const state = { routes: [home, studentStack(page('s1')), studentStack(timer('s1'), review('s1'))], index: 2 };
    expect(studentPageInStack(state, 's1')).toBe(true);
  });

  test('lesson started from Home: no student page', () => {
    const state = { routes: [home, studentStack(timer('s1'), review('s1'))], index: 1 };
    expect(studentPageInStack(state, 's1')).toBe(false);
  });

  test('ignores routes beyond the focused index and handles empty state', () => {
    const state = { routes: [home, studentStack(page('s1'))], index: 0 };
    expect(studentPageInStack(state, 's1')).toBe(false);
    expect(studentPageInStack(null, 's1')).toBe(false);
    expect(studentPageInStack({ routes: [] }, 's1')).toBe(false);
  });

  test('unhydrated student route targeting the page via params', () => {
    const state = { routes: [home, { name: 'student', params: { screen: '[id]/index', params: { id: 's1' } } }] };
    expect(studentPageInStack(state, 's1')).toBe(true);
  });
});

describe('truncateToStudentPage', () => {
  test('timer stack after the student stack: drop it, keep keys of what remains', () => {
    const state = {
      key: 'root',
      index: 2,
      routes: [
        { key: 'h', ...home },
        { key: 'st1', ...studentStack(page('s1')) },
        { key: 'st2', ...studentStack(timer('s1'), review('s1')) },
      ],
    };
    const cut = truncateToStudentPage(state, 's1')!;
    expect(cut.key).toBe('root');
    expect(cut.index).toBe(1);
    expect(cut.routes.map(r => (r as { key: string }).key)).toEqual(['h', 'st1']);
  });

  test('same nested stack: cut the nested stack back to the page', () => {
    const state = { index: 1, routes: [home, studentStack(page('s1'), timer('s1'), review('s1'))] };
    const cut = truncateToStudentPage(state, 's1')!;
    expect(cut.index).toBe(1);
    expect(cut.routes[1].state).toEqual({ routes: [page('s1')], index: 0 });
  });

  test('picks the most recent copy of the page', () => {
    const state = { index: 2, routes: [home, studentStack(page('s1')), studentStack(page('s1'), logPast('s1'))] };
    const cut = truncateToStudentPage(state, 's1')!;
    expect(cut.routes).toHaveLength(3);
    expect(cut.routes[2].state!.routes).toEqual([page('s1')]);
  });

  test('absent → null', () => {
    expect(truncateToStudentPage({ index: 1, routes: [home, studentStack(timer('s1'))] }, 's1')).toBeNull();
    expect(truncateToStudentPage(null, 's1')).toBeNull();
  });
});

describe('lessonSavedNav', () => {
  test('returns to the student page then pushes the summary', () => {
    const state = { routes: [home, studentStack(page('s1'), timer('s1'), review('s1'))], index: 1 };
    const nav = lessonSavedNav({ rootState: state, studentId: 's1', lessonHref: '/lesson/sess-1?justSaved=1' });
    expect(nav).toEqual({
      type: 'returnToStudent',
      resetState: { routes: [home, studentStack(page('s1'))], index: 1 },
      lessonHref: '/lesson/sess-1?justSaved=1',
    });
  });

  test('falls back to replacing with the summary', () => {
    const state = { routes: [home, studentStack(timer('s1'), review('s1'))], index: 1 };
    expect(lessonSavedNav({ rootState: state, studentId: 's1', lessonHref: '/lesson/sess-1' })).toEqual({
      type: 'replace',
      href: '/lesson/sess-1',
    });
  });
});

test('applyLessonSavedNav: reset to the student page, then push summary; or replace', () => {
  const calls: string[] = [];
  const router = {
    push: (h: string) => calls.push(`push ${h}`),
    replace: (h: string) => calls.push(`replace ${h}`),
  };
  const container = { dispatch: (a: { type: string }) => calls.push(`dispatch ${a.type}`) };
  const makeReset = () => ({ type: 'RESET' });
  const resetState = { routes: [home], index: 0 };
  applyLessonSavedNav(router as never, container as never, { type: 'returnToStudent', resetState, lessonHref: '/lesson/x' }, makeReset);
  applyLessonSavedNav(router as never, container as never, { type: 'replace', href: '/lesson/y' }, makeReset);
  expect(calls).toEqual(['dispatch RESET', 'push /lesson/x', 'replace /lesson/y']);
});
