import React, { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FormScreen } from '../../src/components/FormScreen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { useUnsavedChangesGuard } from '../../src/hooks/useUnsavedChangesGuard';
import { isSubjectError } from '../../src/db/subjects';
import { createStudentFromForm } from '../../src/components/student/studentSave';
import { Button, PageHeading } from '../../src/components/student/ui';
import {
  emptyStudentForm, StudentFormFields, useStudentFormOptions,
} from '../../src/components/student/StudentForm';
import {
  hasErrors, isStudentFormDirty, StudentFormValues, validateStudentForm,
} from '../../src/components/student/flowLogic';

export default function NewStudentScreen() {
  const router = useRouter();
  const toast = useToast();
  const options = useStudentFormOptions();
  const savingRef = useRef(false);
  const [initial] = useState<StudentFormValues>(() => emptyStudentForm(options));
  const [values, setValues] = useState<StudentFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const errors = submitted ? validateStudentForm(values, options.travelMode) : {};

  // Unsaved-changes guard (header back, Android back, swipe) — same as Edit.
  const { allowLeave } = useUnsavedChangesGuard(isStudentFormDirty(initial, values), {
    message: "This student hasn't been added yet. Leave and lose what you've typed?",
  });

  function handleSubmit() {
    if (savingRef.current) return;
    setSubmitted(true);
    if (hasErrors(validateStudentForm(values, options.travelMode))) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const s = createStudentFromForm(values, options.travelMode);
      allowLeave();
      toast.show({
        kind: 'success',
        message: 'Student added — add their first top-up?',
        actionLabel: 'Top up',
        onAction: () => router.push(`/student/${s.id}/top-up`),
        durationMs: 8000,
      });
      router.replace(`/student/${s.id}`);
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      const message = isSubjectError(e, 'DUPLICATE') ? 'Two subjects have the same name — rename one' : "Couldn't save student — please try again";
      toast.show({ kind: 'error', message });
    }
  }

  return (
    <FormScreen
      header={<ScreenHeader backLabel="BACK" onBack={() => router.back()} />}
      footer={<Button label="Add student" icon="user-plus" onPress={handleSubmit} busy={saving} />}
    >
      <PageHeading eyebrow="★ ADD STUDENT" line1="Who are you" line2="teaching?" />
      <StudentFormFields
        values={values}
        onChange={patch => setValues(v => ({ ...v, ...patch }))}
        errors={errors}
        options={options}
      />
    </FormScreen>
  );
}
