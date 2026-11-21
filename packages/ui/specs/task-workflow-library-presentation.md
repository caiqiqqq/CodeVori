# Task Workflow Library Presentation

## Behavior

- The workflow library previews each workflow as an ordered chain of enabled stages, with status markers and arrows matching the task workflow model.
- Empty states use the same restrained surface, hierarchy, and spacing as populated library rows and keep the create action visible.
- Workflow definitions, stage ordering, project assignment, and persistence continue to be owned by the existing task workflow service and editor draft.

## Ownership and invariants

- `useTaskWorkflows` remains the source of workflow definitions and project usage.
- `TaskWorkflowEditor` owns only its editable draft until save; the preview is a projection of the persisted definition.
- Presentation changes do not alter workflow execution, stage handoff, project scope, or persisted definitions.

## Acceptance scenarios

- Workflow library rows show a compact ordered stage chain and project usage without duplicate summary prose.
- An empty library presents a clear create action and a concise empty-state message.
- Disabled stages are omitted from the preview while the stage count reflects enabled stages only.
- The workflow library and editor fit desktop and mobile layouts in light and dark themes; keyboard navigation and existing create/edit/save flows remain available.
