import { createContext, useContext, type AriaAttributes } from 'react';

/** What a <Field> hands to the control inside it (Input, Select, Textarea, Checkbox). */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

/** The props a control may already carry (explicit values win over the Field's). */
export interface FieldControlTarget {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  required?: boolean;
}

/** Whether a control is marked invalid (aria-invalid true / "true"). */
export function isInvalid(props: FieldControlTarget): boolean {
  return props['aria-invalid'] === true || props['aria-invalid'] === 'true';
}

export const FieldContext = createContext<FieldControlProps | null>(null);

/**
 * Merge the enclosing Field's id/aria wiring with the control's own props
 * (explicit props win, describedby ids are joined).
 */
export function useFieldControl<P extends FieldControlTarget>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy = [field['aria-describedby'], props['aria-describedby']]
    .filter(Boolean)
    .join(' ');
  return {
    ...props,
    id: props.id ?? field.id,
    required: props.required ?? field.required,
    'aria-invalid': props['aria-invalid'] ?? field['aria-invalid'],
    'aria-describedby': describedBy || undefined,
  };
}
