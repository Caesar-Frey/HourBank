import React, { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FormScreen } from '../../src/components/FormScreen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { createStudent } from '../../src/db/students';
import { Button, PageHeading } from '../../src/components/student/ui';
import {
  EMPTY_STUDENT_FORM, formValuesToPayload, StudentFormFields, useStudentFormOptions,
} from '../../src/components/student/StudentForm';
import { hasErrors, StudentFormValues, validateStudentForm } from '../../src/components/student/flowLogic';

export default function NewStudentScreen() {
  const router = useRouter();
  const toast = useToast();
  const options = useStudentFormOptions();
  const savingRef = useRef(false);
  const [values, setValues] = useState<StudentFormValues>(EMPTY_STUDENT_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const errors = submitted ? validateStudentForm(values, options.travelMode) : {};

  function handleSubmit() {
    if (savingRef.current) return;
    setSubmitted(true);
    if (hasErrors(validateStudentForm(values, options.travelMode))) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const s = createStudent(formValuesToPayload(values));
      toast.show({
        kind: 'success',
        message: 'Student added — add their first top-up?',
        actionLabel: 'Top up',
        onAction: () => router.push(`/student/${s.id}/top-up`),
        durationMs: 8000,
      });
      router.replace(`/student/${s.id}`);
    } catch {
      savingRef.current = false;
      setSaving(false);
      toast.show({ kind: 'error', message: "Couldn't save student — please try again" });
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
