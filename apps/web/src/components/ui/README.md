# UI primitives

Every screen is built from the components in this folder. Import them from the index:

```tsx
import { Button, Card, Field, Input } from '../ui';
```

**Rule: add or extend a primitive here instead of styling raw elements.** If a screen needs a
look that no primitive offers, add a variant or prop here so the next screen gets it for free.
ESLint enforces part of this outside `components/ui/`: raw `<select>`, `<textarea>` and
`<input>` (except `hidden`, `file`, `radio` and `color`), the `.btn` / `.input` classes and
`gray-*` colours are errors.

Colours: use the `neutral-*` scale from the `@theme` block in `src/index.css` (never `gray-*`) and `primary-*`
for the accent. Show user colours (labels, states) with `ColorDot` or `Badge dot`, never as
text colour.

## Actions

| Primitive          | Use                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `Button`           | Text buttons. Variants `primary`, `secondary`, `ghost`, `danger`, `link`; sizes `md`, `sm`, `xs` |
| `IconButton`       | Icon-only buttons; `label` is required and becomes the tooltip                                   |
| `DropdownMenu*`    | Action menus (Radix)                                                                             |
| `SegmentedControl` | Mutually exclusive toggles (Board/List, invite type)                                             |
| `NavItem`          | Entries of a vertical in-page nav (settings tabs)                                                |

```tsx
<Button loading={save.isPending} leadingIcon={<Save />}>Save changes</Button>
<Button asChild variant="secondary"><Link to="/projects">Back to projects</Link></Button>
<IconButton label="Close" icon={<X />} onClick={onClose} />
<SegmentedControl label="View" value={mode} onChange={setMode}
  options={[{ value: 'kanban', label: 'Board' }, { value: 'list', label: 'List' }]} />
<NavItem asChild active={isActive} icon={<User />}><Link to="/settings/user/profile">Profile</Link></NavItem>
```

## Forms

| Primitive  | Use                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `Field`    | Label, hint, error and required marker; wires `id` / `aria-describedby` / `aria-invalid` into its control |
| `Input`    | Text inputs; `size="sm"` for dense rows, `bare` for inline editors                                        |
| `Textarea` | Multi-line text; same sizes and `bare`                                                                    |
| `Select`   | Native `<select>` with an inset chevron; `className` styles the wrapper                                   |
| `Checkbox` | Checkbox with optional `label` and `description`                                                          |

```tsx
<Field label="Name" hint="Shown to your team." error={error} required>
  <Input value={name} onChange={(e) => setName(e.target.value)} />
</Field>
<Field label="Role">
  <Select value={role} onChange={(e) => setRole(e.target.value)}>
    <option value="member">Member</option>
  </Select>
</Field>
<Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label="Enabled" />
```

## Display

| Primitive                  | Use                                                             |
| -------------------------- | --------------------------------------------------------------- |
| `PageHeader`               | Page title, description, actions, back link or breadcrumbs      |
| `Card`                     | White content card with optional title, description and actions |
| `Panel`                    | Bordered box inside a card (rows, sub-sections)                 |
| `Badge`                    | Status and tag pills; tones, `dot`, `onRemove`                  |
| `Avatar`, `AvatarStack`    | Image with initials fallback; overlapping stacks                |
| `ColorDot`                 | A user colour as a dot                                          |
| `Kbd`                      | A keyboard key                                                  |
| `Banner`                   | Inline status message                                           |
| `EmptyState`, `ErrorState` | Empty and failed results                                        |
| `Spinner`, `PageSpinner`   | Loading                                                         |

```tsx
<PageHeader title="Views" description="Saved filters." actions={<Button>New view</Button>} />
<Card title="Workspace" description="General details.">…</Card>
<Panel tone="danger" className="flex items-center justify-between">…</Panel>
<Badge tone="success" shape="pill">This device</Badge>
<Badge tone="outline" shape="pill" dot={label.color}>{label.name}</Badge>
<Avatar src={user.avatarUrl} name={user.name} seed={user.id} size="md" />
<AvatarStack users={task.assignees} max={3} />
```

## Overlays

| Primitive                       | Use                                            |
| ------------------------------- | ---------------------------------------------- |
| `Dialog`                        | Modal or side sheet with focus trap and footer |
| `ConfirmDialog`                 | Confirmation with an async confirm action      |
| `Popover`                       | Pickers and small forms anchored to a trigger  |
| `Tooltip`                       | Hover/focus hints                              |
| `toast`, `toastUndo`, `Toaster` | Notifications, with undo                       |

```tsx
<Dialog open={open} onOpenChange={setOpen} title="Create task"
  footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit">Create</Button></>}>
  …
</Dialog>
<ConfirmDialog open={open} onOpenChange={setOpen} title="Delete 3 tasks?" variant="danger"
  confirmLabel="Delete" onConfirm={() => bulkDelete.mutateAsync(ids)} />
```
