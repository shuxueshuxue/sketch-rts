# Tower upgrade as a work-queue job

A real headless Chromium on the A100 plays through the product surface (`tower-upgrade.mjs`, run as
`node tower-upgrade.mjs SOURCE_DIR PORT OUT_DIR after|before` with `PW` pointing at playwright). A pineshade room gets a
complete defense tower, two archers, and three enemy footmen; the browser selects the tower, clicks its card's upgrade
button, watches the job, box-selects the archers, right-clicks the tower, and calls them down.

1. `1-card-main-left-branch-middle-upgrading-right.webp`: the tower's card. Main shows its own fortify order (left).
   The branch shows `Upgrade to Fortified Tower`, drawn from the new kind's card (middle). Once clicked, that button
   gives way to the job's progress button, at 50% here (right).
2. `2-upgrade-progress-tooltip.webp`: the progress button's tooltip reads `Upgrading to Fortified Tower · Click to
   cancel · full gold refund`, with the new kind's description, which states the +20% range.
3. `3-archers-on-the-upgraded-tower.webp`: both archers on the top after the right-click.

Facts the run recorded from the room's snapshot:

| Step | What the snapshot shows |
| --- | --- |
| After the click | queue `[{kind:"upgrade", id:"upgrade-1000", to:"fortifiedTower", remaining:221, paidGold:100}]`, gold 500 → 400 |
| Progress button | `data-job-id="upgrade-1000"`, label `Upgrading to Fortified Tower`, badge and fill 30–50% |
| Done | kind `fortifiedTower`, maxHp 400, radius 40, attackDamage 0, queue `[]` |
| Archers below / on top / after `All down` | attackRange 319.2 / 383.04 (×1.2) / 319.2 |

The room keeps playing while the page is connected, so the 12 s job can finish during a reload. The script therefore
reads the progress button right after the click, with no reload.
