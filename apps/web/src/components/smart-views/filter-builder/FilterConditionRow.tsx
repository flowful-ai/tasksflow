import { X } from 'lucide-react';
import {
  FilterOperatorSchema,
  type FilterCondition,
  type FilterOperator,
} from '@flowtask/shared/types';
import { IconButton, Select } from '../../ui';
import {
  FILTER_FIELDS,
  OPERATORS_BY_TYPE,
  getFieldsByCategory,
  operatorRequiresValue,
  getOperatorLabel,
} from './constants';
import { FilterValueInput, type FilterValue } from './FilterValueInput';

const isFilterOperator = (value: string): value is FilterOperator =>
  FilterOperatorSchema.safeParse(value).success;

interface WorkspaceMember {
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface Label {
  id: string;
  name: string;
  color: string | null;
}

interface StateCategory {
  value: string;
  label: string;
}

interface Project {
  id: string;
  name: string;
}

interface FilterConditionRowProps {
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
  workspaceMembers: WorkspaceMember[];
  labels: Label[];
  stateCategories: StateCategory[];
  projects: Project[];
}

export function FilterConditionRow({
  condition,
  onChange,
  onRemove,
  workspaceMembers,
  labels,
  stateCategories,
  projects,
}: FilterConditionRowProps) {
  const fieldDef = FILTER_FIELDS[condition.field];
  const fieldType = fieldDef?.type || 'text';
  const validOperators = OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.text;
  const showValue = operatorRequiresValue(condition.op);

  const handleFieldChange = (newField: string) => {
    const newFieldDef = FILTER_FIELDS[newField];
    const newFieldType = newFieldDef?.type || 'text';
    const newValidOperators = OPERATORS_BY_TYPE[newFieldType];

    // Keep the operator if it's still valid, otherwise use the first valid one
    const newOp = newValidOperators.includes(condition.op) ? condition.op : newValidOperators[0];

    onChange({
      field: newField,
      op: newOp,
      value: undefined, // Reset value when field changes
    });
  };

  const handleOperatorChange = (newOp: FilterOperator) => {
    // Clear value when switching to/from null operators
    const oldRequiresValue = operatorRequiresValue(condition.op);
    const newRequiresValue = operatorRequiresValue(newOp);

    onChange({
      ...condition,
      op: newOp,
      value: oldRequiresValue !== newRequiresValue ? undefined : condition.value,
    });
  };

  const handleValueChange = (newValue: FilterValue) => {
    onChange({
      ...condition,
      value: newValue,
    });
  };

  const fieldsByCategory = getFieldsByCategory();

  return (
    <div className="flex items-start gap-2 p-3 bg-neutral-50 rounded-lg group">
      {/* Field selector */}
      <Select
        size="sm"
        className="w-40 flex-shrink-0"
        value={condition.field}
        onChange={(e) => handleFieldChange(e.target.value)}
        aria-label="Field"
      >
        {Object.entries(fieldsByCategory).map(([category, fields]) => (
          <optgroup key={category} label={category}>
            {fields.map(({ field, definition }) => (
              <option key={field} value={field}>
                {definition.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {/* Operator selector */}
      <Select
        size="sm"
        className="w-36 flex-shrink-0"
        value={condition.op}
        onChange={(e) => {
          if (isFilterOperator(e.target.value)) handleOperatorChange(e.target.value);
        }}
        aria-label="Operator"
      >
        {validOperators.map((op) => (
          <option key={op} value={op}>
            {getOperatorLabel(op, fieldType)}
          </option>
        ))}
      </Select>

      {/* Value input */}
      {showValue && (
        <div className="flex-1 min-w-0">
          <FilterValueInput
            fieldType={fieldType}
            operator={condition.op}
            value={condition.value}
            onChange={handleValueChange}
            workspaceMembers={workspaceMembers}
            labels={labels}
            stateCategories={stateCategories}
            projects={projects}
          />
        </div>
      )}

      {/* Remove button */}
      <IconButton
        label="Remove filter"
        onClick={onRemove}
        icon={<X />}
        className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
