import { useState, useRef, useEffect } from 'react';
import {
  Avatar,
  Badge,
  ColorDot,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  controlClasses,
} from '../../ui';
import { X, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { FilterFieldType } from './constants';
import {
  PRIORITY_OPTIONS,
  DATE_TEMPLATES,
  USER_TEMPLATES,
  operatorSupportsMultiple,
} from './constants';
import type { FilterCondition, FilterOperator } from '@flowtask/shared';

/** Popover triggers look like the compact Select. */
const TRIGGER_CLASSES = clsx(
  controlClasses('sm'),
  'flex items-center justify-between text-left hover:border-neutral-300'
);

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

/** Values this editor writes into a filter condition. */
export type FilterValue = string | number | string[] | undefined;

function asString(value: FilterCondition['value']): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: FilterCondition['value']): number {
  return typeof value === 'number' ? value : 0;
}

function asStringArray(value: FilterCondition['value']): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface FilterValueInputProps {
  fieldType: FilterFieldType;
  operator: FilterOperator;
  /** The condition's stored value (shape depends on the field type and operator). */
  value: FilterCondition['value'];
  onChange: (value: FilterValue) => void;
  workspaceMembers: WorkspaceMember[];
  labels: Label[];
  stateCategories: StateCategory[];
  projects: Project[];
}

export function FilterValueInput({
  fieldType,
  operator,
  value,
  onChange,
  workspaceMembers,
  labels,
  stateCategories,
  projects,
}: FilterValueInputProps) {
  const isMultiple = operatorSupportsMultiple(operator);

  switch (fieldType) {
    case 'text':
      return <TextInput value={asString(value)} onChange={onChange} />;

    case 'number':
      return <NumberInput value={asNumber(value)} onChange={onChange} />;

    case 'priority':
      return isMultiple ? (
        <MultiSelect
          options={PRIORITY_OPTIONS}
          value={asStringArray(value)}
          onChange={onChange}
          placeholder="Select priorities..."
        />
      ) : (
        <SingleSelect
          options={PRIORITY_OPTIONS}
          value={asString(value)}
          onChange={onChange}
          placeholder="Select priority..."
        />
      );

    case 'state_category':
      return isMultiple ? (
        <MultiSelect
          options={stateCategories}
          value={asStringArray(value)}
          onChange={onChange}
          placeholder="Select states..."
        />
      ) : (
        <SingleSelect
          options={stateCategories}
          value={asString(value)}
          onChange={onChange}
          placeholder="Select state..."
        />
      );

    case 'date':
      return <DateInput value={asString(value)} onChange={onChange} />;

    case 'user':
      return isMultiple ? (
        <UserMultiSelect
          members={workspaceMembers}
          value={asStringArray(value)}
          onChange={onChange}
        />
      ) : (
        <UserSelect members={workspaceMembers} value={asString(value)} onChange={onChange} />
      );

    case 'label':
      return isMultiple ? (
        <LabelMultiSelect labels={labels} value={asStringArray(value)} onChange={onChange} />
      ) : (
        <LabelSelect labels={labels} value={asString(value)} onChange={onChange} />
      );

    case 'project': {
      const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
      return isMultiple ? (
        <MultiSelect
          options={projectOptions}
          value={asStringArray(value)}
          onChange={onChange}
          placeholder="Select projects..."
        />
      ) : (
        <SingleSelect
          options={projectOptions}
          value={asString(value)}
          onChange={onChange}
          placeholder="Select project..."
        />
      );
    }

    default:
      return <TextInput value={asString(value)} onChange={onChange} />;
  }
}

// Text input
function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      size="sm"
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter value..."
    />
  );
}

// Number input
function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Input
      size="sm"
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : 0)}
      placeholder="Enter number..."
    />
  );
}

// Single select dropdown
interface SelectOption {
  value: string;
  label: string;
  color?: string;
}

function SingleSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: SelectOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Select size="sm" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}

// Multi-select with tags
function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: SelectOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleValue = (val: string) => {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  };

  const removeValue = (e: React.MouseEvent, val: string) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== val));
  };

  const selectedOptions = options.filter((opt) => value.includes(opt.value));

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" className={TRIGGER_CLASSES}>
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {selectedOptions.length === 0 ? (
              <span className="text-neutral-400">{placeholder}</span>
            ) : (
              selectedOptions.map((opt) => (
                <Badge key={opt.value} shape="pill">
                  {opt.color && <ColorDot color={opt.color} size="xs" />}
                  {opt.label}
                  <X
                    className="w-3 h-3 cursor-pointer hover:opacity-75"
                    onClick={(e) => removeValue(e, opt.value)}
                  />
                </Badge>
              ))
            )}
          </div>
          <ChevronDown
            className={clsx('w-4 h-4 text-neutral-400 ml-2 flex-shrink-0', isOpen && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] !p-0 overflow-hidden"
      >
        <div className="max-h-48 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = value.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleValue(opt.value)}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-neutral-50',
                  isSelected && 'bg-primary-50'
                )}
              >
                <span className="flex items-center gap-2">
                  {opt.color && <ColorDot color={opt.color} size="md" />}
                  {opt.label}
                </span>
                {isSelected && <Check className="w-4 h-4 text-primary-600" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Date input with templates
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMode, setInputMode] = useState<'template' | 'custom'>(
    value?.startsWith('{{') ? 'template' : 'custom'
  );

  const selectedTemplate = DATE_TEMPLATES.find((t) => t.value === value);
  const displayValue = selectedTemplate?.label || (value && !value.startsWith('{{') ? value : '');

  const handleTemplateSelect = (templateValue: string) => {
    onChange(templateValue);
    setInputMode('template');
    setIsOpen(false);
  };

  const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setInputMode('custom');
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" className={TRIGGER_CLASSES}>
          <span className={displayValue ? 'text-neutral-900' : 'text-neutral-400'}>
            {displayValue || 'Select date...'}
          </span>
          <ChevronDown className={clsx('w-4 h-4 text-neutral-400', isOpen && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 !p-0 overflow-hidden">
        <div className="p-2 border-b border-neutral-100">
          <p className="text-xs font-medium text-neutral-500 mb-2">Quick options</p>
          <div className="space-y-1">
            {DATE_TEMPLATES.map((template) => (
              <button
                key={template.value}
                type="button"
                onClick={() => handleTemplateSelect(template.value)}
                className={clsx(
                  'w-full px-2 py-1.5 text-sm text-left rounded hover:bg-neutral-100',
                  value === template.value && 'bg-primary-50 text-primary-700'
                )}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-2">
          <p className="text-xs font-medium text-neutral-500 mb-2">Specific date</p>
          <Input
            size="sm"
            type="date"
            value={inputMode === 'custom' && value && !value.startsWith('{{') ? value : ''}
            onChange={handleCustomDateChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// User select
function UserSelect({
  members,
  value,
  onChange,
}: {
  members: WorkspaceMember[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const filteredMembers = members.filter((m) => {
    const name = m.user.name?.toLowerCase() || '';
    const email = m.user.email.toLowerCase();
    const query = search.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const selectedTemplate = USER_TEMPLATES.find((t) => t.value === value);
  const selectedMember = members.find((m) => m.user.id === value);

  const getDisplayValue = () => {
    if (selectedTemplate) return selectedTemplate.label;
    if (selectedMember) return selectedMember.user.name || selectedMember.user.email;
    return '';
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" className={TRIGGER_CLASSES}>
          <span className={getDisplayValue() ? 'text-neutral-900' : 'text-neutral-400'}>
            {getDisplayValue() || 'Select user...'}
          </span>
          <ChevronDown className={clsx('w-4 h-4 text-neutral-400', isOpen && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 !p-0 overflow-hidden">
        {/* Current user template */}
        <div className="border-b border-neutral-100">
          {USER_TEMPLATES.map((template) => (
            <button
              key={template.value}
              type="button"
              onClick={() => {
                onChange(template.value);
                setIsOpen(false);
              }}
              className={clsx(
                'w-full px-3 py-2 text-sm text-left hover:bg-neutral-50',
                value === template.value && 'bg-primary-50 text-primary-700'
              )}
            >
              {template.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-2 border-b border-neutral-100">
          <Input
            size="sm"
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
          />
        </div>

        {/* Members list */}
        <div className="max-h-48 overflow-y-auto">
          {filteredMembers.length === 0 ? (
            <p className="px-3 py-4 text-sm text-neutral-400 text-center">No members found</p>
          ) : (
            filteredMembers.map((member) => (
              <button
                key={member.userId}
                type="button"
                onClick={() => {
                  onChange(member.user.id);
                  setIsOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50',
                  value === member.user.id && 'bg-primary-50'
                )}
              >
                <Avatar name={member.user.name} email={member.user.email} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 truncate">
                    {member.user.name || member.user.email}
                  </p>
                  {member.user.name && (
                    <p className="text-xs text-neutral-500 truncate">{member.user.email}</p>
                  )}
                </div>
                {value === member.user.id && <Check className="w-4 h-4 text-primary-600" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// User multi-select
function UserMultiSelect({
  members,
  value,
  onChange,
}: {
  members: WorkspaceMember[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  const toggleValue = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const removeValue = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== id));
  };

  const filteredMembers = members.filter((m) => {
    const name = m.user.name?.toLowerCase() || '';
    const email = m.user.email.toLowerCase();
    const query = search.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const selectedMembers = members.filter((m) => value.includes(m.user.id));
  const hasCurrentUser = value.includes('{{current_user}}');

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" className={TRIGGER_CLASSES}>
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {value.length === 0 ? (
              <span className="text-neutral-400">Select users...</span>
            ) : (
              <>
                {hasCurrentUser && (
                  <Badge shape="pill" tone="primary">
                    Current user (me)
                    <X
                      className="w-3 h-3 cursor-pointer hover:opacity-75"
                      onClick={(e) => removeValue(e, '{{current_user}}')}
                    />
                  </Badge>
                )}
                {selectedMembers.map((member) => (
                  <Badge key={member.userId} shape="pill">
                    {member.user.name || member.user.email}
                    <X
                      className="w-3 h-3 cursor-pointer hover:opacity-75"
                      onClick={(e) => removeValue(e, member.user.id)}
                    />
                  </Badge>
                ))}
              </>
            )}
          </div>
          <ChevronDown
            className={clsx('w-4 h-4 text-neutral-400 ml-2 flex-shrink-0', isOpen && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 !p-0 overflow-hidden">
        {/* Current user template */}
        <div className="border-b border-neutral-100">
          <button
            type="button"
            onClick={() => toggleValue('{{current_user}}')}
            className={clsx(
              'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-neutral-50',
              hasCurrentUser && 'bg-primary-50 text-primary-700'
            )}
          >
            <span>Current user (me)</span>
            {hasCurrentUser && <Check className="w-4 h-4 text-primary-600" />}
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-neutral-100">
          <Input
            size="sm"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
          />
        </div>

        {/* Members list */}
        <div className="max-h-48 overflow-y-auto">
          {filteredMembers.length === 0 ? (
            <p className="px-3 py-4 text-sm text-neutral-400 text-center">No members found</p>
          ) : (
            filteredMembers.map((member) => {
              const isSelected = value.includes(member.user.id);
              return (
                <button
                  key={member.userId}
                  type="button"
                  onClick={() => toggleValue(member.user.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50',
                    isSelected && 'bg-primary-50'
                  )}
                >
                  <Avatar name={member.user.name} email={member.user.email} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate">
                      {member.user.name || member.user.email}
                    </p>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary-600" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Label select
function LabelSelect({
  labels,
  value,
  onChange,
}: {
  labels: Label[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  const filteredLabels = labels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));

  const selectedLabel = labels.find((l) => l.id === value);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" className={TRIGGER_CLASSES}>
          <span className={selectedLabel ? 'text-neutral-900' : 'text-neutral-400'}>
            {selectedLabel ? (
              <span className="flex items-center gap-2">
                <ColorDot color={selectedLabel.color} size="md" />
                {selectedLabel.name}
              </span>
            ) : (
              'Select label...'
            )}
          </span>
          <ChevronDown className={clsx('w-4 h-4 text-neutral-400', isOpen && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 !p-0 overflow-hidden">
        <div className="p-2 border-b border-neutral-100">
          <Input
            size="sm"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search labels..."
            autoFocus
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filteredLabels.length === 0 ? (
            <p className="px-3 py-4 text-sm text-neutral-400 text-center">No labels found</p>
          ) : (
            filteredLabels.map((label) => (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  onChange(label.id);
                  setIsOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50',
                  value === label.id && 'bg-primary-50'
                )}
              >
                <ColorDot color={label.color} size="md" />
                <span className="text-sm text-neutral-700 truncate">{label.name}</span>
                {value === label.id && <Check className="w-4 h-4 text-primary-600 ml-auto" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Label multi-select
function LabelMultiSelect({
  labels,
  value,
  onChange,
}: {
  labels: Label[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  const toggleValue = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const removeValue = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== id));
  };

  const filteredLabels = labels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));

  const selectedLabels = labels.filter((l) => value.includes(l.id));

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" className={TRIGGER_CLASSES}>
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {selectedLabels.length === 0 ? (
              <span className="text-neutral-400">Select labels...</span>
            ) : (
              selectedLabels.map((label) => (
                <Badge key={label.id} shape="pill" tone="outline">
                  <ColorDot color={label.color} size="xs" />
                  {label.name}
                  <X
                    className="w-3 h-3 cursor-pointer hover:opacity-75"
                    onClick={(e) => removeValue(e, label.id)}
                  />
                </Badge>
              ))
            )}
          </div>
          <ChevronDown
            className={clsx('w-4 h-4 text-neutral-400 ml-2 flex-shrink-0', isOpen && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 !p-0 overflow-hidden">
        <div className="p-2 border-b border-neutral-100">
          <Input
            size="sm"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search labels..."
            autoFocus
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filteredLabels.length === 0 ? (
            <p className="px-3 py-4 text-sm text-neutral-400 text-center">No labels found</p>
          ) : (
            filteredLabels.map((label) => {
              const isSelected = value.includes(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => toggleValue(label.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50',
                    isSelected && 'bg-primary-50'
                  )}
                >
                  <ColorDot color={label.color} size="md" />
                  <span className="text-sm text-neutral-700 truncate flex-1">{label.name}</span>
                  {isSelected && <Check className="w-4 h-4 text-primary-600" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
