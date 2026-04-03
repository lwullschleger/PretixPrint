# Istruzioni per Claude Code

## Regole generali

- Dopo ogni modifica al codice, aggiornare sempre **SPEC.md** per rispecchiare le modifiche apportate (dipendenze, architettura, script, comportamenti).
- Nei messaggi di commit git non menzionare mai Claude (niente "Co-Authored-By", niente riferimenti a Claude o AI).
- Non fare mai dei commit di tua spontanea volontà, te lo devo sempre dire io
- Dopo aver creato un tag git in locale, fare sempre subito `git push --tags` per sincronizzarlo su GitHub
- Dall'endpoint `/orderpositions/` usare solo i campi fissi di Pretix: `attendee_name`, `attendee_name_parts` (given_name, family_name), `attendee_email`, `company`, `order`, `secret`. Non includere mai i campi dinamici (`answers`, domande custom) perché cambiano per evento e renderebbero il codice fragile.