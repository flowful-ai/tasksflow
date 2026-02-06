import { useState, useRef, useEffect } from 'react';
import { X, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { FilterFieldType } from './constants';
import {
  PRIORITY_OPTIONS,
  DATE_TEMPLATES,
  USER_TEMPLATES,
  operatorSupportsMultiple,
} from './constants';
import type { FilterOperator } from '@flowtask/shared';

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

interface FilterValueInputProps {
  fieldType: FilterFieldType;
  operator: FilterOperator;
  value: unknown;
  onChange: (value: unknown) => void;
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
      return <TextInput value={value as string} onChange={onChange} />;

    case 'number':
      return <NumberInput value={value as number} onChange={onChange} />;

    case 'priority':
      return isMultiple ? (
        <MultiSelect
          options={PRIORITY_OPTIONS}
          value={(value as string[]) || []}
          onChange={onChange}
          placeholder="Select priorities..."
        />
      ) : (
        <SingleSelect
          options={PRIORITY_OPTIONS}
          value={value as string}
          onChange={onChange}
          placeholder="Select priority..."
        />
      );

    case 'state_category':
      return isMultiple ? (
        <MultiSelect
          options={stateCategories}
          value={(value as string[]) || []}
          onChange={onChange}
          placeholder="Select states..."
        />
      ) : (
        <SingleSelect
          options={stateCategories}
          value={value as string}
          onChange={onChange}
          placeholder="Select state..."
        />
      );

    case 'date':
      return <DateInput value={value as string} onChange={onChange} />;

    case 'user':
      return isMultiple ? (
        <UserMultiSelect
          members={workspaceMembers}
          value={(value as string[]) || []}
          onChange={onChange}
        />
      ) : (
        <UserSelect
          members={workspaceMembers}
          value={value as string}
          onChange={onChange}
        />
      );

    case 'label':
      return isMultiple ? (
        <LabelMultiSelect labels={labels} value={(value as string[]) || []} onChange={onChange} />
      ) : (
        <LabelSelect labels={labels} value={value as string} onChange={onChange} />
      );

    case 'project': {
      const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
      return isMultiple ? (
        <MultiSelect
          options={projectOptions}
          value={(value as string[]) || []}
          onChange={onChange}
          placeholder="Select projects..."
        />
      ) : (
        <SingleSelect
          options={projectOptions}
          value={value as string}
          onChange={onChange}
          placeholder="Select project..."
        />
      );
    }

    default:
      return <TextInput value={value as string} onChange={onChange} />;
  }
}

// Text input
function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter value..."
      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
    />
  );
}

// Number input
function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : 0)}
      placeholder="Enter number..."
      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          'bg-white border-gray-200'
        )}
      >
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {selectedOptions.length === 0 ? (
            <span className="text-gray-400">{placeholder}</span>
          ) : (
            selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700"
                style={opt.color ? { backgroundColor: `${opt.color}20`, color: opt.color } : undefined}
              >
                {opt.label}
                <X
                  className="w-3 h-3 cursor-pointer hover:opacity-75"
                  onClick={(e) => removeValue(e, opt.value)}
                />
              </span>
            ))
          )}
        </div>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400 ml-2 flex-shrink-0', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {options.map((opt) => {
              const isSelected = value.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleValue(opt.value)}
                  className={clsx(
                    'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50',
                    isSelected && 'bg-primary-50'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {opt.color && (
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: opt.color }}
                      />
                    )}
                    {opt.label}
                  </span>
                  {isSelected && <Check className="w-4 h-4 text-primary-600" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Date input with templates
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMode, setInputMode] = useState<'template' | 'custom'>(
    value?.startsWith('{{') ? 'template' : 'custom'
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          'bg-white border-gray-200'
        )}
      >
        <span className={displayValue ? 'text-gray-900' : 'text-gray-400'}>
          {displayValue || 'Select date...'}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">Quick options</p>
            <div className="space-y-1">
              {DATE_TEMPLATES.map((template) => (
                <button
                  key={template.value}
                  type="button"
                  onClick={() => handleTemplateSelect(template.value)}
                  className={clsx(
                    'w-full px-2 py-1.5 text-sm text-left rounded hover:bg-gray-100',
                    value === template.value && 'bg-primary-50 text-primary-700'
                  )}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-2">
            <p className="text-xs font-medium text-gray-500 mb-2">Specific date</p>
            <input
              type="date"
              value={inputMode === 'custom' && value && !value.startsWith('{{') ? value : ''}
              onChange={handleCustomDateChange}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
      )}
    </div>
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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          'bg-white border-gray-200'
        )}
      >
        <span className={getDisplayValue() ? 'text-gray-900' : 'text-gray-400'}>
          {getDisplayValue() || 'Select user...'}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {/* Current user template */}
          <div className="border-b border-gray-100">
            {USER_TEMPLATES.map((template) => (
              <button
                key={template.value}
                type="button"
                onClick={() => {
                  onChange(template.value);
                  setIsOpen(false);
                }}
                className={clsx(
                  'w-full px-3 py-2 text-sm text-left hover:bg-gray-50',
                  value === template.value && 'bg-primary-50 text-primary-700'
                )}
              >
                {template.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Members list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-400 text-center">No members found</p>
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
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50',
                    value === member.user.id && 'bg-primary-50'
                  )}
                >
                  <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-primary-600">
                      {(member.user.name?.[0] || member.user.email[0]).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {member.user.name || member.user.email}
                    </p>
                    {member.user.name && (
                      <p className="text-xs text-gray-500 truncate">{member.user.email}</p>
                    )}
                  </div>
                  {value === member.user.id && <Check className="w-4 h-4 text-primary-600" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          'bg-white border-gray-200'
        )}
      >
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {value.length === 0 ? (
            <span className="text-gray-400">Select users...</span>
          ) : (
            <>
              {hasCurrentUser && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 text-primary-700">
                  Current user (me)
                  <X
                    className="w-3 h-3 cursor-pointer hover:opacity-75"
                    onClick={(e) => removeValue(e, '{{current_user}}')}
                  />
                </span>
              )}
              {selectedMembers.map((member) => (
                <span
                  key={member.userId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700"
                >
                  {member.user.name || member.user.email}
                  <X
                    className="w-3 h-3 cursor-pointer hover:opacity-75"
                    onClick={(e) => removeValue(e, member.user.id)}
                  />
                </span>
              ))}
            </>
          )}
        </div>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400 ml-2 flex-shrink-0', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {/* Current user template */}
          <div className="border-b border-gray-100">
            <button
              type="button"
              onClick={() => toggleValue('{{current_user}}')}
              className={clsx(
                'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50',
                hasCurrentUser && 'bg-primary-50 text-primary-700'
              )}
            >
              <span>Current user (me)</span>
              {hasCurrentUser && <Check className="w-4 h-4 text-primary-600" />}
            </button>
          </div>

          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Members list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-400 text-center">No members found</p>
            ) : (
              filteredMembers.map((member) => {
                const isSelected = value.includes(member.user.id);
                return (
                  <button
                    key={member.userId}
                    type="button"
                    onClick={() => toggleValue(member.user.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50',
                      isSelected && 'bg-primary-50'
                    )}
                  >
                    <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-medium text-primary-600">
                        {(member.user.name?.[0] || member.user.email[0]).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {member.user.name || member.user.email}
                      </p>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-primary-600" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const filteredLabels = labels.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedLabel = labels.find((l) => l.id === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          'bg-white border-gray-200'
        )}
      >
        <span className={selectedLabel ? 'text-gray-900' : 'text-gray-400'}>
          {selectedLabel ? (
            <span className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: selectedLabel.color || '#9ca3af' }}
              />
              {selectedLabel.name}
            </span>
          ) : (
            'Select label...'
          )}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search labels..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredLabels.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-400 text-center">No labels found</p>
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
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50',
                    value === label.id && 'bg-primary-50'
                  )}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: label.color || '#9ca3af' }}
                  />
                  <span className="text-sm text-gray-700 truncate">{label.name}</span>
                  {value === label.id && <Check className="w-4 h-4 text-primary-600 ml-auto" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
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

  const filteredLabels = labels.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedLabels = labels.filter((l) => value.includes(l.id));

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          'bg-white border-gray-200'
        )}
      >
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {selectedLabels.length === 0 ? (
            <span className="text-gray-400">Select labels...</span>
          ) : (
            selectedLabels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full"
                style={{
                  backgroundColor: label.color ? `${label.color}20` : '#e5e7eb',
                  color: label.color || '#374151',
                }}
              >
                {label.name}
                <X
                  className="w-3 h-3 cursor-pointer hover:opacity-75"
                  onClick={(e) => removeValue(e, label.id)}
                />
              </span>
            ))
          )}
        </div>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400 ml-2 flex-shrink-0', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search labels..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredLabels.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-400 text-center">No labels found</p>
            ) : (
              filteredLabels.map((label) => {
                const isSelected = value.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleValue(label.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50',
                      isSelected && 'bg-primary-50'
                    )}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: label.color || '#9ca3af' }}
                    />
                    <span className="text-sm text-gray-700 truncate flex-1">{label.name}</span>
                    {isSelected && <Check className="w-4 h-4 text-primary-600" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
