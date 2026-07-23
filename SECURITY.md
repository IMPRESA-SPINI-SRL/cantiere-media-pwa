# Modello di sicurezza

## PIN locale

Il PIN non viene memorizzato in chiaro. Ogni utente possiede un salt casuale e una derivazione PBKDF2-SHA-256. Dopo cinque errori consecutivi l'accesso viene bloccato temporaneamente.

Il PIN protegge l'interfaccia dell'applicazione, ma non cifra foto e video. Chi controlla completamente il dispositivo o il profilo del browser puo potenzialmente accedere ai dati locali. Il dispositivo deve quindi avere blocco schermo, cifratura di sistema e aggiornamenti di sicurezza attivi.

Le operazioni distruttive non si fidano soltanto della sessione in memoria: ruolo e stato dell'utente vengono riletti dentro la transazione IndexedDB che modifica i dati. Un amministratore disattivato o retrocesso da un'altra scheda non conserva quindi privilegi distruttivi. Le preferenze dei cantieri sono dati locali non autorizzativi e vengono separate tramite l'identificatore dell'utente e il contesto Caricamento/Archivio.

## Distribuzione

In produzione l'app deve essere pubblicata su HTTPS. Non disattivare la Content Security Policy presente in `index.html` e non aggiungere script remoti senza una revisione esplicita.

## Dati e backup

La release 1.7.0 conserva una copia locale e carica gli originali nella cartella OneDrive del cantiere. Finche il riquadro OneDrive non conferma il completamento, la cancellazione dei dati del sito o il ripristino del dispositivo puo rendere irrecuperabile il file non ancora sincronizzato.

L'URL temporaneo della sessione di caricamento e preautenticato: viene conservato soltanto nella coda IndexedDB per consentire la ripresa, non deve essere copiato, registrato nei log o condiviso. La Content Security Policy limita le destinazioni di rete ai servizi aziendali e agli host OneDrive/SharePoint necessari.

## Segnalazione problemi

Prima di distribuire una modifica che riguarda autenticazione, permessi, cancellazioni, importazione o migrazioni IndexedDB, eseguire tutti i test e una prova su dispositivi Android e iPhone reali.

## Sessione persistente e dispositivo

La sessione rimane attiva fino al comando `Esci`. Di conseguenza, chi puo sbloccare il telefono o il profilo del computer puo aprire l'app senza reinserire il PIN. Il dispositivo deve quindi essere protetto da codice, impronta o altro blocco di sistema. La sessione contiene solo l'identificativo utente; il PIN continua a essere derivato con PBKDF2 e non viene memorizzato in chiaro.

## Impronte dei file

Le impronte SHA-256 servono a riconoscere duplicati esatti nel cantiere selezionato. Non permettono di ricostruire foto o video; vengono inviate al backend aziendale per applicare la deduplicazione centrale tra dispositivi. File visivamente simili ma ricodificati, ritagliati o modificati producono impronte diverse e non vengono considerati duplicati.



## Accesso centralizzato 1.7.0

- PIN di 6 cifre verificato esclusivamente dal backend Azure.
- Token di sessione opaco memorizzato localmente; sul server viene conservato solo l'hash.
- Attivazione tramite codice monouso con scadenza.
- Ripristino offline consentito solo dopo un primo accesso online riuscito e fino alla scadenza della sessione.

## Eliminazione locale e archivio OneDrive

In questa release l'eliminazione dall'Archivio della PWA rimuove metadati, blob e miniature dal dispositivo, ma non cancella il file gia archiviato su OneDrive. Anche la cancellazione di un cantiere nell'app non elimina automaticamente la relativa cartella OneDrive.
