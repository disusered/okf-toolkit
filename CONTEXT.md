# OKF Toolkit

OKF Toolkit provides shared, domain-neutral operations over one Open Knowledge
Format bundle at a time. Consumer projects retain their own authority, policy,
and domain tooling.

## Language

**Bundle**:
A self-contained hierarchy of OKF Markdown documents and the unit addressed by every toolkit operation.
_Avoid_: Vault, corpus registry, federation

**Consumer**:
A project or service that applies its own context and policy while using the toolkit's generic bundle operations.
_Avoid_: Plugin, tenant

**Profile**:
A consumer-owned set of additional validation rules applied after OKF v0.2 conformance.
_Avoid_: OKF schema, global policy

**Adapter**:
A storage-specific implementation that reads and changes one Bundle without changing its meaning.
_Avoid_: Bundle, Consumer

**Projection**:
A deterministic, rebuildable presentation derived from a Bundle that carries no authority of its own.
_Avoid_: Source, publication

**Bundle Analysis**:
The versioned, transport-neutral result of parsing one Bundle, including documents, metadata, links, graph data, and diagnostics.
_Avoid_: Index database, merged graph

**Document Revision**:
An opaque storage-provided token used only to detect whether one document changed between review and application.
_Avoid_: Bundle version, semantic version

**Integrity Result**:
Cryptographic evidence that exact bundle bytes match a signed manifest, kept separate from OKF semantic verification and consumer trust.
_Avoid_: Trust tier, human review
