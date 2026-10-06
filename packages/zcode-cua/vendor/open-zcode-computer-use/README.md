# Open ZCode Computer Use

[![CI](https://github.com/hqhq1025/open-zcode-computer-use/actions/workflows/ci.yml/badge.svg)](https://github.com/hqhq1025/open-zcode-computer-use/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Clean-room, macOS-only reimplementation of the public ZCode CUA 0.5.12 MCP
contract.

It exposes the same 30 tool names and the same complete input-schema shapes as
the inspected plugin, while using independently written JavaScript orchestration
and the MIT-licensed `OpenComputerUseKit` native implementation.

## What It Implements

- Newline-delimited MCP over stdio.
- Accessibility-first app and window observation.
- Session-local `state_id` values with expiry, bounded retention, supersession,
  and one-action consumption.
- Raster-bound `frame_id` values with SHA-256 integrity metadata.
- Window and display screenshots through ScreenCaptureKit.
- AX click, value, selection, scroll, and secondary actions.
- Coordinate-to-window ownership checks and AX hit-testing before raw clicks.
- PID-scoped keyboard input and clipboard access.
- Serialized mutations, kill-switch latching, subagent rejection, and
  `not_sent` versus `possibly_sent` transport reporting.
- All 30 public ZCode CUA 0.5.12 tools.

The exact reverse-engineering evidence is in
[`docs/zcode-cua-0.5.12-reverse-engineering.md`](docs/zcode-cua-0.5.12-reverse-engineering.md).
The native function inventory and local reproduction method are described in
[`docs/ax-native-0.5.12-function-inventory.md`](docs/ax-native-0.5.12-function-inventory.md).
The recovered SkyLight ABI, event fields, focus records, and branch matrix are in
[`docs/skylight-background-input-0.5.12.md`](docs/skylight-background-input-0.5.12.md).
The implementation comparison and remaining differences are in
[`docs/compatibility.md`](docs/compatibility.md).

## Requirements

- macOS 14 or newer.
- Node.js 22 or newer.
- Swift 6.2 toolchain.
- Accessibility and Screen Recording permission for the process that launches
  the MCP server.

## Build

```bash
git clone https://github.com/hqhq1025/open-zcode-computer-use.git
cd open-zcode-computer-use
npm run build:native
npm run verify
```

## MCP Configuration

Use absolute paths for your own checkout:

```json
{
  "mcpServers": {
    "open-zcode-computer-use": {
      "command": "/usr/bin/env",
      "args": [
        "node",
        "/path/to/open-zcode-computer-use/src/mcp-server.mjs"
      ],
      "env": {
        "OPEN_ZCODE_CUA_NATIVE": "/path/to/open-zcode-computer-use/native/.build/release/OpenZCodeNative"
      }
    }
  }
}
```

Run a non-mutating permission and display check with:

```bash
npm run doctor
```

## Safety Defaults

The default mode does not permit operations that require the physical system
pointer. Semantic AX actions and supported PID/window-scoped operations remain
available.

To opt into physical-pointer fallback for raw move and split mouse-down/up:

```bash
OPEN_ZCODE_CUA_ALLOW_GLOBAL_POINTER=1 npm start
```

That mode can move the visible cursor and should only be enabled deliberately.

`stop_computer_control` is latched for the lifetime of the MCP process. Start a
new MCP session to resume control.

## Provenance

No proprietary ZCode JavaScript, helper binary, token, signing material, or
private source is included.

Raw disassembly, decompiler projects, complete string dumps, and proprietary
bundles are intentionally excluded. The scripts under `scripts/` can recreate
local research artifacts from a ZCode installation you are authorized to
inspect; generated output is ignored by Git.

The native source under `native/Sources/OpenComputerUseKit` is adapted from the
MIT-licensed `open-codex-computer-use` implementation at commit
`3c1a938dcfef2cb2e9b0ddb8c7cac316c6c2bdbe`. The surrounding MCP adapter,
registries, schema definitions, and ZCode compatibility behavior were written
for this project from observed public behavior and locally extracted tool
schemas.
