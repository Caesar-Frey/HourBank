import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { useToast } from '../../../src/components/Toast';
import { useUnsavedChangesGuard } from '../../../src/hooks/useUnsavedChangesGuard';
import { getStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { getPrimarySubjectId, getSubjectBalances, isSubjectError, listStudentSubjects } from '../../../src/db/subjects';
import { listUpcomingWithProjection } from '../../../src/db/sessions';
import { updateStudentFromForm } from '../../../src/components/student/studentSave';
import { subjectDraftsFromRows } from '../../../src/components/student/subjectLogic';
import { Button, LoadingState, NotFoundState, PageHeading } from '../../../src/components/student/ui';
import {
  studentToFormValues, StudentFormFields, useStudentFormOptions,
} from '../../../src/components/student/StudentForm';
import { confirmArchiveStudent } from '../../../src/components/student/studentActions';
import {
  archivedToastMessage, hasErrors, isStudentFormDirty, StudentFormValues, validateStudentForm,
} from '../../../src/components/student/flowLogic';

export default function EditStudentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const options = useStudentFormOptions();
  const savingRef = useRef(false);

  const [initial, setInitial] = useState<StudentFormValues | null>(null);
  const [values, setValues] = useState<StudentFormValues | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      if (s) {
        const balances: Record<string, number> = {};
        for (const b of getSubjectBalances(id)) balances[b.id] = b.balance_hours;
        const primary = getPrimarySubjectId(id);
        const booked: Record<string, number> = {};
        for (const l of listUpcomingWithProjection(id)) {
          const key = l.subject_id ?? primary;
          if (key) booked[key] = (booked[key] ?? 0) + 1;
        }
        const drafts = subjectDraftsFromRows(listStudentSubjects(id, { includeArchived: true }), balances, booked);
        const v = studentToFormValues(s, drafts);
        setInitial(v);
        setValues(v);
      }
    } catch {
      // handled by the not-found state
    } finally {
      setLoaded(true);
    }
  }, [id]);

  const dirty = !!initial && !!values && isStudentFormDirty(initial, values);

  // Unsaved-changes guard (header back, Android back, programmatic back).
  const { allowLeave } = useUnsavedChangesGuard(dirty, {
    message: 'Your edits to this student have not been saved.',
  });

  if (!loaded) return <LoadingState />;
  if (!values) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const formValues = values;
  const errors = submitted ? validateStudentForm(formValues, options.travelMode) : {};

  function handleSubmit() {
    if (savingRef.current) return;
    setSubmitted(true);
    if (hasErrors(validateStudentForm(formValues, options.travelMode))) return;
    if (!dirty) {
      allowLeave();
      router.back();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      updateStudentFromForm(id, initial!, formValues, options.travelMode);
      allowLeave();
      toast.show({ kind: 'success', message: 'Changes saved' });
      router.back();
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      const message = isSubjectError(e, 'DUPLICATE')
        ? 'That subject name is already in use — rename it'
        : isSubjectError(e, 'LAST_ACTIVE')
          ? 'Keep at least one subject'
          : "Couldn't save changes — please try again";
      toast.show({ kind: 'error', message });
    }
  }

  function handleArchive() {
    let balance = 0;
    try { balance = currentBalance(id); } catch { /* show without credit line */ }
    confirmArchiveStudent({
      studentId: id,
      name: formValues.fullName.trim() || 'this student',
      balance,
      onArchived: cancelled => {
        allowLeave();
        toast.show({
          kind: 'success',
          message: archivedToastMessage(cancelled),
          actionLabel: 'View archived',
          onAction: () => router.push('/student/archived'),
        });
        router.dismissTo('/');
      },
      onError: message => toast.show({ kind: 'error', message }),
    });
  }

  return (
    <FormScreen
      header={<ScreenHeader backLabel="BACK" onBack={() => router.back()} />}
      footer={<Button label={dirty ? 'Save changes' : 'Done'} icon="check" onPress={handleSubmit} busy={saving} />}
    >
      <PageHeading eyebrow="★ EDIT STUDENT" line1="Update" line2="details." />
      <StudentFormFields
        values={formValues}
        onChange={patch => setValues(v => (v ? { ...v, ...patch } : v))}
        errors={errors}
        options={options}
      />
      <TouchableOpacity
        onPress={handleArchive}
        activeOpacity={0.7}
        accessibilityRole="button"
        style={{ alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH, marginTop: 8 }}
      >
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, textDecorationLine: 'underline' }}>
          Archive student
        </Text>
      </TouchableOpacity>
    </FormScreen>
  );
}
