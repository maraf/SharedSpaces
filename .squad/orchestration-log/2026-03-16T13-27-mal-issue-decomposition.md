# Spawn Log: Mal (Lead)

**Timestamp:** 2026-03-16T13:27:00Z  
**Agent:** Mal (Lead/Architect)  
**Mode:** background  
**Task:** Decompose README implementation plan into GitHub issues

## Outcome

✓ **Success**

Created 14 GitHub issues (#17–#30) spanning 5 phases with proper:
- Granular, coherent work units (10–15 issues target met)
- Detailed acceptance criteria as checkbox lists
- Explicit cross-issue dependencies
- Labels: `squad` + `phase:N` + category (backend/frontend/infrastructure/real-time)

### Phase Breakdown

| Phase | Issues | Focus |
|-------|--------|-------|
| 1 (Core Server) | #17–#21 (5 issues) | Highest complexity; foundational API + auth |
| 2 (Real-time) | #22 (1 issue) | SignalR hub implementation |
| 3 (React Client) | #23–#26 (4 issues) | Parallel UI work; join flow, space view, upload |
| 4 (Admin UI) | #27 (1 issue) | Dashboard, space mgmt |
| 5 (Offline & Polish) | #28–#30 (3 issues) | Offline queue, polish, Docker Compose |

### Key Architectural Decisions Embedded

- Client-generated item GUIDs (PUT/upsert semantics)
- JWT claims include `server_url` for multi-server client support
- Admin auth via `X-Admin-Secret` header (not JWT)
- File storage abstraction layer
- Invitation PINs deleted immediately after JWT issuance
- JWT has no expiration; validity enforced via `SpaceMember.IsRevoked`

## Decisions Logged

Merged into `.squad/decisions/inbox/mal-issue-decomposition.md` for Scribe to promote to `decisions.md`.

## Next Steps

- Scribe: merge inbox → decisions.md, update agent history (Kaylee, Wash, Zoe), commit
- Team: review issues, assign, execute in phase order
