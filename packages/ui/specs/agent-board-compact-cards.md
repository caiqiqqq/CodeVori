## Agent board compact cards

The status-column layout shows narrow cards to keep multiple status groups visible. Give
each card a taller content area so titles and supporting details have room to scan, while
preserving the existing column and card width. The project-grouped card grid keeps its
current natural height.

`AgentBoardGroups` selects this presentation for status grouping and `AgentBoardCard`
owns its geometry through an optional `compact` prop (default false). It adds no
persisted preference, protocol, or data state. The checked-out version has no separate
compact/cards/list mode selector, so this change applies to the existing status-column
cards without introducing a new mode or restoring removed features.

Card content gains 40px of height through vertical padding (16px → 36px on each side)
and can grow with translated text or larger UI fonts.
Keep the existing responsive column widths: 288px below the desktop breakpoint and
flexible columns with a 240px minimum above it. Keep all existing widths, padding,
title truncation, themes, click targets, staging, and drag behavior. No data migration
or new failure path is needed.

Acceptance: the layout E2E checks taller status cards, the existing desktop column
width, 288px mobile cards with the extra vertical padding and without page overflow,
project-grouped cards at their natural
height, and light/dark presentation. Existing detail opening and staging scenarios
remain applicable.
