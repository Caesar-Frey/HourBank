/**
 * lessonNav.ts — where to go after a lesson is saved (end-session / log-past).
 *
 * If that student's page is already in the navigation stack, return to it and
 * push the lesson summary on top ([…, student, lesson]) so Back from the
 * summary lands on the student page. Otherwise replace the current screen with
 * the summary (previous behaviour). Either way the live timer / form is popped,
 * so Back never returns to a dead timer.
 */

export type NavRouteLike = {
  name: string;
  params?: object;
  state?: NavStateLike;
};
export type NavStateLike = {
  routes: NavRouteLike[];
  index?: number;
};

export type LessonSavedNav =
  | { type: 'returnToStudent'; resetState: NavStateLike; lessonHref: string }
  /** No student page in the stack (lesson started from Home): drop the timer/form stacks, then push. */
  | { type: 'dismissFlow'; resetState: NavStateLike; lessonHref: string }
  | { type: 'replace'; href: string };

function paramId(params: object | undefined): unknown {
  return params && 'id' in params ? (params as { id?: unknown }).id : undefined;
}

function isStudentPage(route: NavRouteLike, studentId: string): boolean {
  // Route inside the nested `student` stack…
  if ((route.name === '[id]/index' || route.name === '[id]') && paramId(route.params) === studentId) return true;
  // …or a not-yet-hydrated `student` route that targets the page via params.
  if (route.name === 'student' && !route.state && route.params && 'screen' in route.params) {
    const p = route.params as { screen?: unknown; params?: object };
    return (p.screen === '[id]/index' || p.screen === '[id]') && paramId(p.params) === studentId;
  }
  return false;
}

/** True when the student's page is somewhere in the live (mounted) stack. */
export function studentPageInStack(state: NavStateLike | null | undefined, studentId: string): boolean {
  if (!state?.routes?.length) return false;
  const last = typeof state.index === 'number' ? state.index : state.routes.length - 1;
  for (let i = 0; i <= last && i < state.routes.length; i++) {
    const route = state.routes[i];
    if (isStudentPage(route, studentId)) return true;
    if (route.state && studentPageInStack(route.state, studentId)) return true;
  }
  return false;
}

/**
 * The navigation state cut back to the most recent copy of the student's page
 * (everything above it — timer, review, log-past form — removed). Route keys
 * are kept so the remaining screens aren't remounted. null when absent.
 */
export function truncateToStudentPage<S extends NavStateLike>(
  state: S | null | undefined,
  studentId: string,
): S | null {
  if (!state?.routes?.length) return null;
  const last = Math.min(typeof state.index === 'number' ? state.index : state.routes.length - 1, state.routes.length - 1);
  for (let i = last; i >= 0; i--) {
    const route = state.routes[i];
    if (isStudentPage(route, studentId)) {
      return { ...state, routes: state.routes.slice(0, i + 1), index: i };
    }
    const sub = route.state ? truncateToStudentPage(route.state, studentId) : null;
    if (sub) {
      const routes = state.routes.slice(0, i + 1);
      routes[i] = { ...route, state: sub };
      return { ...state, routes, index: i };
    }
  }
  return null;
}

/** Root routes that belong to the lesson flow being left: the picker and student stacks (timer, review, form). */
function isLessonFlowRoute(route: NavRouteLike): boolean {
  return route.name === 'student' || route.name === 'start-lesson';
}

/**
 * The root state with the trailing lesson-flow routes removed (B3), so Back
 * from the summary returns to Home instead of re-entering the dead timer.
 * null when nothing would be removed or nothing would remain.
 */
export function truncateLessonFlow<S extends NavStateLike>(state: S | null | undefined): S | null {
  if (!state?.routes?.length) return null;
  let end = Math.min(typeof state.index === 'number' ? state.index : state.routes.length - 1, state.routes.length - 1);
  const last = end;
  while (end >= 0 && isLessonFlowRoute(state.routes[end])) end--;
  if (end === last || end < 0) return null;
  return { ...state, routes: state.routes.slice(0, end + 1), index: end };
}

export function lessonSavedNav(args: {
  rootState: NavStateLike | null | undefined;
  studentId: string;
  lessonHref: string;
}): LessonSavedNav {
  const resetState = truncateToStudentPage(args.rootState, args.studentId);
  if (resetState) return { type: 'returnToStudent', resetState, lessonHref: args.lessonHref };
  const base = truncateLessonFlow(args.rootState);
  if (base) return { type: 'dismissFlow', resetState: base, lessonHref: args.lessonHref };
  return { type: 'replace', href: args.lessonHref };
}

type RouterLike = {
  push: (href: never) => void;
  replace: (href: never) => void;
};
type NavContainerLike = { dispatch: (action: never) => void };

/**
 * Perform a LessonSavedNav: reset the stack back to the student page, then
 * push the summary on top. (expo-router's dismissTo can't target a page that
 * lives in an earlier sibling `student` stack, so the stack is reset directly.)
 */
export function applyLessonSavedNav(
  router: RouterLike,
  container: NavContainerLike,
  nav: LessonSavedNav,
  makeReset: (state: NavStateLike) => unknown,
): void {
  if (nav.type === 'returnToStudent' || nav.type === 'dismissFlow') {
    container.dispatch(makeReset(nav.resetState) as never);
    router.push(nav.lessonHref as never);
  } else {
    router.replace(nav.href as never);
  }
}
