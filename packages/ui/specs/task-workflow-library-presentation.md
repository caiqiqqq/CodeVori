# Task Workflow Library Presentation

## Behavior

- The workflow library previews each workflow as an ordered chain of enabled stages, with status markers and arrows matching the task workflow model.
- Empty states use the same restrained surface, hierarchy, and spacing as populated library rows and keep the create action visible.
- Workflow definitions, stage ordering, project assignment, and persistence continue to be owned by the existing task workflow service and editor draft.
- After a successful catalog read, always show a built-in Default workflow before custom definitions, including in an otherwise empty library. Its localized stages are Backlog, Todo (start), In progress, In review, Blocked, Done and Canceled, matching the existing workflow editor template.
- The Default row opens read-only stage details and cannot be deleted or overwritten. Custom workflows remain editable.
- Project selection labels the existing null binding as Default workflow; choosing it removes the custom binding through the existing service command. Do not present a second duplicate default option.

## Ownership and invariants

- `useTaskWorkflows` remains the source of workflow definitions and project usage.
- `TaskWorkflowEditor` owns only its editable draft until save; the preview is a projection of the persisted definition.
- Presentation changes do not alter workflow execution, stage handoff, project scope, or persisted definitions.
- The built-in default is static UI metadata projected alongside service-owned custom definitions by `useTaskWorkflows`; it is never saved as a custom definition or assigned by its reserved ID. The existing null binding continues to select the runtime's built-in lifecycle. Reads must not fabricate a successful catalog when the service fails.

## Acceptance scenarios

- Workflow library rows show a compact ordered stage chain and project usage without duplicate summary prose.
- A catalog with no custom definitions shows exactly one Default workflow. Opening it displays all built-in stages without save/delete controls; returning and creating a custom workflow still works.
- Choosing a custom workflow and then Default submits a null workflow binding and does not execute an Agent. Refreshing settings still shows one default entry without a definition-save command.
- Disabled stages are omitted from the preview while the stage count reflects enabled stages only.
- The workflow library and editor fit desktop and mobile layouts in light and dark themes; keyboard navigation and existing create/edit/save flows remain available.
