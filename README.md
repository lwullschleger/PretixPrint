# Pretix Print Service

Applicazione desktop Windows che stampa automaticamente i badge quando un partecipante effettua il check-in su Pretix.

---

## Funzionalità

- Interroga Pretix periodicamente (polling) e rileva i nuovi check-in in tempo reale
- Genera il badge localmente usando il layout configurato su Pretix e lo stampa automaticamente
- Dashboard con log dei check-in, stato stampa, ristampa e anteprima per ogni partecipante
- Configurazione completa dall'interfaccia grafica — nessun file da editare manualmente
- Barra di stato con connettività API, organizzatore ed evento in tempo reale
- Log delle chiamate API con filtro errori e filtro debug

> **Non richiede porte aperte o indirizzi IP esposti.** Tutto il traffico è uscente verso `pretix.eu`.

---

## Requisiti

- Windows 10 o superiore
- Stampante compatibile con driver Windows standard (testato con Brother QL)
- Account Pretix con token API

---

## Installazione

```bash
npm install
npm start
```

Per buildare l'installer Windows:

```bash
npm run build
# Output: dist/pretix-print-service Setup.exe
```

---

## Configurazione

Tutta la configurazione avviene dalla scheda **Configurazione** nell'app. I parametri vengono salvati automaticamente in `data/config.json` e ripristinati ad ogni avvio.

### Token API Pretix

1. Accedi al pannello admin di Pretix
2. Vai su **Impostazioni → Team → Token API**
3. Crea un token con permesso **Leggi tutti gli ordini**
4. Incolla il token nella scheda Configurazione e clicca **Carica**

### Parametri disponibili

| Parametro | Descrizione |
|---|---|
| API Token | Token di accesso all'API Pretix |
| Organizzatore | Selezionato da dropdown dopo aver inserito il token |
| Evento | Selezionato da dropdown a cascata sull'organizzatore |
| Stampante | Stampante locale su cui inviare i badge |
| Stampa automatica | Se attiva, stampa il badge ad ogni check-in rilevato |
| Usa sfondo badge | Scarica e usa il PDF di sfondo configurato nel layout badge Pretix |
| Intervallo polling | Secondi tra una verifica e l'altra (default: 5) |

---

## Utilizzo

### Dashboard

- Mostra i check-in rilevati in ordine cronologico con nome, azienda, orario e stato stampa
- Per ogni riga: pulsante **ristampa** (icona stampante) e **anteprima** (icona lente) che apre il PDF con il visualizzatore di sistema
- Avviso visibile se la stampa automatica è disattivata

### Configurazione

- Il pulsante **Salva** diventa arancione in presenza di modifiche non salvate
- Uscire dalla tab con modifiche non salvate mostra un avviso di conferma
- Il campo **Layout badge** mostra il nome del layout attivo scaricato da Pretix; il pulsante **Update** forza il ri-download
- **Cancella Check-in effettuati** svuota il log locale (con conferma)

### Log API

- Mostra tutte le chiamate HTTP verso Pretix con orario, metodo, endpoint e status code
- Filtro **Solo errori** per isolare i problemi
- Filtro **Nascondi debug** (attivo per default) per nascondere le chiamate cicliche di polling e status

---

## Struttura dati locali

| File | Contenuto |
|---|---|
| `data/config.json` | Configurazione salvata dall'app |
| `data/checkins.json` | Log dei check-in con dati partecipante e stato stampa |

---

## Note tecniche

- Il badge viene generato localmente usando il layout JSON di Pretix (formato libpretixprint) tramite `pdf-lib`
- I campi supportati nel badge: `attendee_name`, `attendee_name:given_name`, `attendee_name:family_name`, `attendee_company`, `attendee_email`, `order_code`, `secret`
- Il layout badge e il PDF di sfondo vengono cachati in memoria all'avvio e invalidati al salvataggio della configurazione
- Una sola istanza dell'app può girare contemporaneamente; una seconda apertura porta in focus la finestra già aperta

Per la documentazione tecnica completa vedere [SPEC.md](SPEC.md).
