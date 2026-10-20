# ZCode integration provenance

Source: https://github.com/hqhq1025/open-zcode-computer-use

Revision: 202395e65218f83086b30daceb0f11d2f3430dd8

License: MIT; original LICENSE and NOTICE are retained alongside the source.

Imported: JavaScript runtime, Swift native source, upstream tests and public
schema fixture. Research utilities and proprietary artifacts are not imported.

Local changes are limited to compiler compatibility, a non-prompting permission
utility, explicit native launch options and transport cleanup/cancellation.
ZCode's plugin packaging, cross-process lease and permission adapter live outside
this vendor directory. Physical pointer fallback is disabled in the built-in
plugin. This implementation has no proprietary CUA broker authority or PiP.
