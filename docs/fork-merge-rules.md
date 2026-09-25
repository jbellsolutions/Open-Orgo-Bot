# Fork merge rules (Open Orgo Bot <- OpenMausBot)

Worktree: the current directory (merge in progress, NOT committed).
Sides: `HEAD` = the fork. `$UPSTREAM_REF` = upstream. Common base: `$BASE_REF` (last merged upstream).

Understand each side's intent BEFORE editing a hunk:
- Fork intent:     git diff $BASE_REF HEAD -- <file>
- Upstream intent: git diff $BASE_REF $UPSTREAM_REF -- <file>   (also `git log --oneline $BASE_REF..$UPSTREAM_REF -- <file>`)

## Protected fork invariants (fork wins on these)
1. Product identity: "Open Orgo Bot", bundle id `ai.openorgobot.app`, storage `~/.openorgobot`, URL scheme, update feed jbellsolutions/open-orgo-bot, artwork.
2. Hermes is the DEFAULT engine; other engines stay available.
3. Orgo is the cloud-computer provider. NO Box runtime adapter, no BOX_TOKEN, no calls into server/box.ts / drivers/boxagent.ts (those files are deleted in the fork and must stay deleted). Where upstream adds Box-based features, drop the Box path or route to the fork's Orgo equivalent only if an obvious equivalent exists; otherwise remove the Box branch cleanly.
4. Encrypted desktop credential storage; verified Orgo computer UUIDs.
5. Exact-ID, fail-closed team workstations (team-computers) and the one-turn lease.
6. Built-in Super Browser mount + approval gates.
7. Desktop mutation-header compatibility contract.
8. No upstream `enterprise/` (deleted; drop imports/references to enterprise code).

## Everything else: take upstream
New upstream features, bug fixes, refactors, renamed APIs, new i18n keys: keep them. When both sides changed the same lines for unrelated reasons, combine both. Adapt fork code to upstream renames/signature changes.

User-facing leftover "OpenMausBot"/"openmausbot.com" strings the fork missed -> "Open Orgo Bot" is fine to fix in files you own, BUT do not rename internal protocol message types, env var names (OPENMAUSBOT_*), package names (@openmausbot/*), or file names.

## Hard rules
- Remove every conflict marker (<<<<<<< ======= >>>>>>>) in every conflicted file.
- Do NOT run git add/commit/checkout/reset/merge/stash or pnpm install (`git rm` of a Box/enterprise-only file is fine). The maintenance script stages, verifies and commits.
- Final output: one line per file you changed, and every judgment call touching Box/Orgo/Hermes/enterprise.
