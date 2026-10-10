import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { useToast } from '../../../src/components/Toast';
import { useUnsavedChangesGuard } from '../../../src/hooks/useUnsavedChangesGuard';
import { getStudent, updateStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { Button, LoadingState, NotFoundState, PageHeading } from '../../../src/components/student/ui';
import {
  formValuesToPayload, studentToFormValues, StudentFormFields, useStudentFormOptions,
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
        const v = studentToFormValues(s);
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
      updateStudent(id, formValuesToPayload(formValues));
      allowLeave();
      toast.show({ kind: 'success', message: 'Changes saved' });
      router.back();
    } catch {
      savingRef.current = false;
      setSaving(false);
      toast.show({ kind: 'error', message: "Couldn't save changes — please try again" });
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
