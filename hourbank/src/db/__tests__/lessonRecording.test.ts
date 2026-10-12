import { createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  createScheduled,
  startSession,
  createAndStartUnscheduled,
  recordLesson,
  editLesson,
  logPastSession,
  markNoShow,
  rescheduleSession,
  updateScheduled,
  listAgenda,
  listUpcomingWithProjection,
  listForStudent,
  checkOweLimit,
  getSession,
  getSessionWithStudent,
  isSessionError,
} from '../sessions';
import { createStudent, updateStudent } from '../students';
import { addStudentSubject, getPrimarySubjectId, getSubjectBalance, isSubjectError } from '../subjects';
import { createPackage } from '../packages';
import { currentBalance, getSessionDeduction } from '../ledger';
import { finaliseClaim, getClaimLines } from '../claims';
import { upsertTutorProfile } from '../tutorProfile';

const NOW = new Date('2026-10-12T15:00:00.000Z');
const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

function setup(db: TestDb) {
  const s = createStudent({
    ...base,
    travelDistanceKm: 10,
    parentTravelMode: 'per_km',
    parentTravelPerKm: 5,
  });
  const maths = getPrimarySubjectId(s.id)!;
  const sci = addStudentSubject({ studentId: s.id, subject: 'Science' }).id;
  createPackage({ studentId: s.id, subjectId: maths, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
  createPackage({ studentId: s.id, subjectId: sci, hoursAdded: 2, amountPaid: 1100, paymentMethod: 'eft' });
  void db;
  return { s, maths, sci };
}

describe('lesson recording + editing (Phase A)', () => {
  let db: TestDb;
  beforeEach(() => { db = createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  describe('scheduling carries subject + km', () => {
    it('createScheduled stores subject and km override; defaults to primary subject', () => {
      const { s, sci, maths } = setup(db);
      const a = createScheduled({ studentId: s.id, subjectId: sci, travelKm: 14, scheduledFor: '2026-10-20T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
      expect(a).toMatchObject({ subject_id: sci, travel_km: 14 });
      expect(getSession(a.id)).toMatchObject({ subject_id: sci, travel_km: 14 });
      const b = createScheduled({ studentId: s.id, scheduledFor: '2026-10-21T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
      expect(getSession(b.id)).toMatchObject({ subject_id: maths, travel_km: null });
    });

    it('rejects a subject of another student', () => {
      const { s } = setup(db);
      const other = createStudent({ ...base, fullName: 'Other' });
      expect(() => createScheduled({ studentId: s.id, subjectId: getPrimarySubjectId(other.id), scheduledFor: '2026-10-20T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' }))
        .toThrow();
    });

    it('rescheduleSession / updateScheduled update km and subject', () => {
      const { s, sci, maths } = setup(db);
      const a = createScheduled({ studentId: s.id, scheduledFor: '2026-10-20T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
      rescheduleSession(a.id, '2026-10-22T10:00:00.000Z', { travelKm: 7 });
      expect(getSession(a.id)!.travel_km).toBe(7);
      rescheduleSession(a.id, '2026-10-22T11:00:00.000Z');
      expect(getSession(a.id)!.travel_km).toBe(7);
      rescheduleSession(a.id, '2026-10-22T11:00:00.000Z', { travelKm: null });
      expect(getSession(a.id)!.travel_km).toBeNull();
      updateScheduled(a.id, { scheduledFor: '2026-10-23T10:00:00.000Z', estimatedDurationMinutes: 90, mode: 'in_person', session_type: 'general', topics: [], subjectId: sci, travelKm: 3 });
      expect(getSession(a.id)).toMatchObject({ subject_id: sci, travel_km: 3 });
      updateScheduled(a.id, { scheduledFor: '2026-10-23T10:00:00.000Z', estimatedDurationMinutes: 90, mode: 'in_person', session_type: 'general', topics: [] });
      expect(getSession(a.id)).toMatchObject({ subject_id: sci, travel_km: 3 });
      void maths;
    });

    it('agenda + upcoming items carry the lesson subject; projection is per subject', () => {
      const { s, sci } = setup(db);
      createScheduled({ studentId: s.id, subjectId: sci, scheduledFor: '2026-10-20T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
      createScheduled({ studentId: s.id, scheduledFor: '2026-10-21T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
      createScheduled({ studentId: s.id, subjectId: sci, scheduledFor: '2026-10-22T10:00:00.000Z', estimatedDurationMinutes: 90, mode: 'in_person', session_type: 'general' });
      const agenda = listAgenda(NOW);
      expect(agenda.upcoming.map(i => [i.subject_name, i.student_subject])).toEqual([
        ['Science', 'Science'], ['Maths', 'Maths'], ['Science', 'Science'],
      ]);
      expect(listUpcomingWithProjection(s.id, NOW).map(u => u.projected_balance_after)).toEqual([1, 9, -0.5]);
    });
  });

  describe('owe limit per subject', () => {
    it('checks the lesson subject balance, not the total', () => {
      const { s, sci, maths } = setup(db);
      expect(checkOweLimit(s.id, 180, sci)).toMatchObject({ balanceHours: 2, overLimit: true, subjectId: sci });
      expect(checkOweLimit(s.id, 180, maths)).toMatchObject({ balanceHours: 10, overLimit: false });
      expect(checkOweLimit(s.id, 60).balanceHours).toBe(10); // primary
      const sch = createScheduled({ studentId: s.id, subjectId: sci, scheduledFor: '2026-10-12T14:00:00.000Z', estimatedDurationMinutes: 180, mode: 'in_person', session_type: 'general' });
      expect(() => startSession(sch.id)).toThrow(expect.objectContaining({ code: 'OVER_OWE_LIMIT' }));
      expect(startSession(sch.id, { allowOverOwe: true }).status).toBe('active');
    });

    it('createAndStartUnscheduled takes a subject', () => {
      const { s, sci } = setup(db);
      const live = createAndStartUnscheduled({ studentId: s.id, subjectId: sci, mode: 'online', estimatedMinutes: 60 });
      expect(live.subject_id).toBe(sci);
    });
  });

  describe('recordLesson', () => {
    it('records an unscheduled lesson: completed + deduction on that subject + travel snapshot', () => {
      const { s, sci, maths } = setup(db);
      const { session, entry } = recordLesson({
        studentId: s.id, subjectId: sci, startedAt: '2026-10-12T10:00:00.000Z', billedMinutes: 90,
        topics: ['Forces'], notes: 'Good', mode: 'in_person', now: NOW,
      });
      expect(session).toMatchObject({
        status: 'completed', subject_id: sci, billed_minutes: 90, duration_minutes: 90,
        started_at: '2026-10-12T10:00:00.000Z', ended_at: '2026-10-12T11:30:00.000Z',
        travel_km: 10, parent_travel_fee: 50, session_notes: 'Good', edited_at: null,
      });
      expect(entry).toMatchObject({ type: 'session_deduction', hours_delta: -1.5, subject_id: sci, related_session_id: session.id });
      expect(getSubjectBalance(s.id, sci)).toBe(0.5);
      expect(getSubjectBalance(s.id, maths)).toBe(10);
    });

    it('uses km override and actual minutes; online lessons carry no travel', () => {
      const { s } = setup(db);
      const a = recordLesson({ studentId: s.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, minutes: 55, travelKm: 22, topics: [], mode: 'in_person', now: NOW });
      expect(a.session).toMatchObject({ duration_minutes: 55, billed_minutes: 60, travel_km: 22, parent_travel_fee: 110 });
      const b = recordLesson({ studentId: s.id, startedAt: '2026-10-12T11:00:00.000Z', billedMinutes: 60, travelKm: 22, topics: [], mode: 'online', now: NOW });
      expect(b.session).toMatchObject({ travel_km: null, parent_travel_fee: 0 });
    });

    it('flat and none parent travel modes', () => {
      const flat = createStudent({ ...base, fullName: 'Flat', parentTravelMode: 'flat', parentTravelFlatFee: 80 });
      const none = createStudent({ ...base, fullName: 'None', parentTravelMode: 'none', parentTravelFlatFee: 80 });
      expect(recordLesson({ studentId: flat.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, topics: [], now: NOW }).session.parent_travel_fee).toBe(80);
      expect(recordLesson({ studentId: none.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, topics: [], now: NOW }).session.parent_travel_fee).toBe(0);
    });

    it('completes a scheduled lesson, keeping its subject and booked km', () => {
      const { s, sci } = setup(db);
      const sch = createScheduled({ studentId: s.id, subjectId: sci, travelKm: 4, scheduledFor: '2026-10-12T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'review', notes: 'Bring book' });
      const { session } = recordLesson({ sessionId: sch.id, studentId: s.id, startedAt: '2026-10-12T10:05:00.000Z', billedMinutes: 60, topics: ['Waves'], now: NOW });
      expect(session).toMatchObject({ id: sch.id, status: 'completed', subject_id: sci, travel_km: 4, parent_travel_fee: 20, session_notes: 'Bring book', session_type: 'review' });
      expect(getSessionDeduction(sch.id)).toMatchObject({ hours_delta: -1, subject_id: sci });
    });

    it('completes a running timer lesson (timer end flow lands on Record)', () => {
      const { s } = setup(db);
      const live = createAndStartUnscheduled({ studentId: s.id, mode: 'in_person', now: new Date('2026-10-12T13:00:00.000Z') });
      const { session } = recordLesson({ sessionId: live.id, studentId: s.id, startedAt: live.started_at!, billedMinutes: 60, minutes: 58, topics: [], now: NOW });
      expect(session.status).toBe('completed');
      expect(session.paused_at).toBeNull();
    });

    it('rejects bad input and already-recorded lessons', () => {
      const { s } = setup(db);
      const ok = recordLesson({ studentId: s.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, topics: [], now: NOW });
      expect(() => recordLesson({ sessionId: ok.session.id, studentId: s.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, topics: [], now: NOW }))
        .toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
      expect(() => recordLesson({ studentId: s.id, startedAt: '2026-10-13T09:00:00.000Z', billedMinutes: 60, topics: [], now: NOW }))
        .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      expect(() => recordLesson({ studentId: s.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 0, topics: [], now: NOW }))
        .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      expect(() => recordLesson({ studentId: s.id, startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, travelKm: -1, topics: [], now: NOW }))
        .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      const other = createStudent({ ...base, fullName: 'Other' });
      let err: unknown;
      try {
        recordLesson({ studentId: s.id, subjectId: getPrimarySubjectId(other.id), startedAt: '2026-10-12T09:00:00.000Z', billedMinutes: 60, topics: [], now: NOW });
      } catch (e) { err = e; }
      expect(isSubjectError(err, 'WRONG_STUDENT')).toBe(true);
    });

    it('logPastSession and markNoShow book against the lesson subject', () => {
      const { s, sci } = setup(db);
      const past = logPastSession({ studentId: s.id, subjectId: sci, startedAt: '2026-10-12T09:00:00.000Z', minutes: 60, topics: [], now: NOW });
      expect(past.entry.subject_id).toBe(sci);
      expect(past.session.parent_travel_fee).toBe(50);
      const sch = createScheduled({ studentId: s.id, subjectId: sci, scheduledFor: '2026-10-12T08:00:00.000Z', estimatedDurationMinutes: 30, mode: 'in_person', session_type: 'general' });
      const ns = markNoShow(sch.id, { charge: true });
      expect(ns.entry).toMatchObject({ subject_id: sci, hours_delta: -0.5 });
      expect(getSubjectBalance(s.id, sci)).toBe(0.5);
    });
  });

  describe('editLesson', () => {
    function recorded(db2: TestDb) {
      const ctx = setup(db2);
      const { session } = recordLesson({ studentId: ctx.s.id, startedAt: '2026-10-12T10:00:00.000Z', billedMinutes: 60, topics: ['A'], notes: 'n', mode: 'in_person', now: NOW });
      return { ...ctx, id: session.id };
    }

    it('changes billed minutes: updates the deduction in place and stamps edited_at', () => {
      const { s, maths, id } = recorded(db);
      const ledgerCount = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_entries')!.n;
      const res = editLesson(id, { billedMinutes: 90, now: NOW });
      expect(res.inClaim).toBe(false);
      expect(res.session).toMatchObject({ billed_minutes: 90, edited_at: NOW.toISOString() });
      expect(getSessionDeduction(id)).toMatchObject({ hours_delta: -1.5 });
      expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_entries')!.n).toBe(ledgerCount);
      expect(getSubjectBalance(s.id, maths)).toBe(8.5);
      expect(currentBalance(s.id)).toBe(10.5);
    });

    it('moves the hours when the subject changes', () => {
      const { s, maths, sci, id } = recorded(db);
      editLesson(id, { subjectId: sci, now: NOW });
      expect(getSession(id)!.subject_id).toBe(sci);
      expect(getSessionDeduction(id)!.subject_id).toBe(sci);
      expect(getSubjectBalance(s.id, maths)).toBe(10);
      expect(getSubjectBalance(s.id, sci)).toBe(1);
    });

    it('updates date/time, minutes, topics, notes', () => {
      const { id } = recorded(db);
      const { session } = editLesson(id, { startedAt: '2026-10-11T08:00:00.000Z', minutes: 45, topics: ['B'], notes: null, now: NOW });
      expect(session).toMatchObject({
        started_at: '2026-10-11T08:00:00.000Z', ended_at: '2026-10-11T08:45:00.000Z',
        duration_minutes: 45, billed_minutes: 60, topics: JSON.stringify(['B']), session_notes: null,
      });
    });

    it('recomputes the parent travel charge only when km or mode change, at the CURRENT rate', () => {
      const { s, id } = recorded(db);
      expect(getSession(id)!.parent_travel_fee).toBe(50);
      updateStudent(s.id, { ...base, parentTravelPerKm: 6 });
      editLesson(id, { billedMinutes: 75, now: NOW });
      expect(getSession(id)!.parent_travel_fee).toBe(50); // rate change never reprices
      editLesson(id, { travelKm: 12, now: NOW });
      expect(getSession(id)).toMatchObject({ travel_km: 12, parent_travel_fee: 72 });
      editLesson(id, { mode: 'online', now: NOW });
      expect(getSession(id)).toMatchObject({ mode: 'online', parent_travel_fee: 0 });
    });

    it('allows editing a claimed lesson but reports inClaim; the claim snapshot is unchanged', () => {
      upsertTutorProfile({ hourly_rate: 300 });
      const { id } = recorded(db);
      const { claim } = finaliseClaim({ sessionIds: [id] });
      const res = editLesson(id, { billedMinutes: 120, now: NOW });
      expect(res.inClaim).toBe(true);
      expect(getClaimLines(claim.id)[0]).toMatchObject({ billed_hours: 1, lesson_fee: 300 });
    });

    it('only edits recorded (completed) lessons and validates input', () => {
      const { s, id } = recorded(db);
      const sch = createScheduled({ studentId: s.id, scheduledFor: '2026-10-20T10:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
      expect(() => editLesson(sch.id, { billedMinutes: 30 })).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
      expect(() => editLesson('nope', { billedMinutes: 30 })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(() => editLesson(id, { billedMinutes: -5 })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      expect(() => editLesson(id, { startedAt: '2027-01-01T00:00:00.000Z', now: NOW })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      expect(isSessionError(new Error('x'))).toBe(false);
    });

    it('lesson reads expose the lesson subject name', () => {
      const { s, sci, id } = recorded(db);
      editLesson(id, { subjectId: sci, now: NOW });
      expect(getSessionWithStudent(id)!.subject).toBe('Science');
      expect(listForStudent(s.id, undefined, sci).map(x => x.id)).toEqual([id]);
    });
  });
});
