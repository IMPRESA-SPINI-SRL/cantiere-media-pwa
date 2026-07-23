# Verifica release 1.7.0

Data: 2026-07-23.

## Controlli automatici completati

- PWA: `npm test`, 62 test superati su 62.
- PWA: `npm run check`, 44 file JavaScript validi.
- Backend: `npm test`, 8 test superati su 8.
- Backend: `npm run check`, sintassi valida per funzioni e librerie.
- Versione `1.7.0` coerente tra `package.json`, configurazione, bootstrap, manifest e Service Worker.
- Versione backend `0.4.0` esposta dall'endpoint pubblico di salute.
- Schema IndexedDB aggiornato alla versione 5 con store `mediaSync`.
- Migrazione dei media locali non ancora sincronizzati verso la coda verificata staticamente.
- Scrittura atomica di metadato, blob e record di coda verificata.
- Rimozione della coda insieme a media o cantieri eliminati verificata.
- Frammenti normalizzati a multipli di 320 KiB e dimensione operativa di 5 MiB verificati con test.
- Calcolo dell'ultimo frammento e lettura di `nextExpectedRanges` verificati con test.
- Ripresa tramite URL e offset persistiti, retry e gestione sessione scaduta verificati staticamente.
- API backend per creazione sessione e conferma finale collegate alla PWA.
- Deduplicazione centrale per `siteId + SHA-256` e nome OneDrive deterministico verificati con test.
- Content Security Policy e application shell includono gli host e i moduli OneDrive necessari.
- Stato OneDrive, avanzamento e comando `Riprova ora` collegati alla schermata principale.
- Test precedenti su autenticazione, cantieri, duplicati locali, galleria, permessi e viewer restano superati.

## Limiti verificati della release

- Il file viene salvato localmente prima dell'invio remoto.
- La PWA carica gli originali su OneDrive ma non scarica automaticamente sul secondo dispositivo l'archivio remoto.
- L'eliminazione nell'Archivio rimuove la copia locale e la relativa coda; non elimina il file gia completato su OneDrive.
- La cancellazione di un cantiere nell'app non elimina automaticamente la cartella OneDrive.

## Collaudo reale richiesto dopo la distribuzione

Il build environment non dispone delle credenziali del tenant aziendale, quindi il flusso Microsoft Graph deve essere collaudato sulla Function App reale:

1. pubblicare il backend 0.4.0 e verificare `/api/health`;
2. pubblicare la PWA 1.7.0 su un solo dispositivo di prova;
3. creare o scegliere un cantiere di prova;
4. caricare una fotografia piccola e controllare il passaggio da attesa a `OneDrive aggiornato`;
5. verificare nella cartella OneDrive `foto` la creazione della cartella cantiere e del file;
6. ripetere lo stesso file dallo stesso e da un secondo dispositivo, verificando l'assenza di duplicati;
7. interrompere la rete durante un video, riattivarla e verificare la ripresa;
8. provare un nuovo file in modalita aereo e controllare l'invio al ritorno online;
9. soltanto dopo questi controlli distribuire la release agli altri utenti.

## Comandi di verifica

PWA:

```bash
npm test
npm run check
```

Backend:

```bash
npm test
npm run check
```
