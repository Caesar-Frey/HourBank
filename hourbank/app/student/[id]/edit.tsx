import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { useToast } from '../../../src/components/Toast';
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
  const navigation = useNavigation();
  const toast = useToast();
  const options = useStudentFormOptions();
  const savingRef = useRef(false);
  /** Set once saved/archived so the unsaved-changes guard lets navigation through. */
  const leavingRef = useRef(false);

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
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Unsaved-changes guard (header back, Android back, programmatic back).
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      if (leavingRef.current || !dirtyRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'Your edits to this student have not been saved.', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [navigation]);

  if (!loaded) return <LoadingState />;
  if (!values) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const formValues = values;
  const errors = submitted ? validateStudentForm(formValues, options.travelMode) : {};

  function handleSubmit() {
    if (savingRef.current) return;
    setSubmitted(true);
    if (hasErrors(validateStudentForm(formValues, options.travelMode))) return;
    if (!dirty) {
      leavingRef.current = true;
      router.back();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      updateStudent(id, formValuesToPayload(formValues));
      leavingRef.current = true;
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
        leavingRef.current = true;
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
